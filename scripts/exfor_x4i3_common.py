import math
import re

PROJECTILE_MAP = {'N': 'n', 'P': 'p', 'G': 'g', 'D': 'd', 'A': 'a', 'HE3': 'h', 'H': 'h'}
SUPPORTED_Q = {'SIG', 'DA', 'DE', 'FY', 'MACS'}
ELEMENTS = (
    "H HE LI BE B C N O F NE NA MG AL SI P S CL AR K CA SC TI V CR MN FE CO NI CU ZN "
    "GA GE AS SE BR KR RB SR Y ZR NB MO TC RU RH PD AG CD IN SN SB TE I XE CS BA LA CE "
    "PR ND PM SM EU GD TB DY HO ER TM YB LU HF TA W RE OS IR PT AU HG TL PB BI PO AT RN "
    "FR RA AC TH PA U NP PU AM CM BK CF ES FM MD NO LR RF DB SG BH HS MT DS RG CN NH FL "
    "MC LV TS OG"
).split()
SYMBOL_TO_Z = {symbol: index + 1 for index, symbol in enumerate(ELEMENTS)}


def parse_target(target: str):
    match = re.match(r'^([A-Z]{1,3})-(\d+)(?:-M(\d*)?)?$', target or '')
    if not match:
        return None
    symbol, mass, meta_state = match.groups()
    z = SYMBOL_TO_Z.get(symbol)
    if z is None:
        return None
    state = int(meta_state) if meta_state else (1 if meta_state is not None else 0)
    return z, int(mass), state


def to_num(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value).strip()
        if not text or text in {'-', 'NA', 'N/A'}:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def energy_to_ev(value, unit):
    if value is None:
        return None
    unit = (unit or '').upper().strip()
    factors = {'EV': 1.0, 'KEV': 1e3, 'MEV': 1e6, 'GEV': 1e9, 'MILLI-EV': 1e-3, 'UEV': 1e-6, 'NEV': 1e-9}
    if unit in factors:
        return value * factors[unit]
    if unit == 'K':
        return value * 8.617333262e-5
    return value


def kt_to_kev(value, unit):
    if value is None:
        return None
    unit = (unit or '').upper().strip()
    if unit == 'KEV':
        return value
    if unit == 'EV':
        return value / 1e3
    if unit == 'MEV':
        return value * 1e3
    if unit == 'GEV':
        return value * 1e6
    if unit == 'K':
        return value * 8.617333262e-8
    return value


def find_index(labels, candidates):
    for candidate in candidates:
        if candidate in labels:
            return labels.index(candidate)
    return None


def extract_points(dataset, quantity, max_points):
    labels = [str(item).upper() if item is not None else '' for item in getattr(dataset, 'labels', [])]
    units = [str(item).upper() if item is not None else '' for item in getattr(dataset, 'units', [])]
    if not labels:
        return []

    data_index = find_index(labels, ['DATA'])
    if data_index is None:
        energy_labels = {'EN', 'ENERGY', 'EN-LAB', 'EN-CM', 'EN-RSL', 'KT', 'KT-K'}
        for index, label in enumerate(labels):
            if 'ERR' in label or label.startswith('D(') or label in energy_labels:
                continue
            data_index = index
            break
    if data_index is None:
        return []

    energy_index = find_index(labels, ['EN', 'ENERGY', 'EN-LAB', 'EN-CM', 'EN-RSL', 'E'])
    kt_index = find_index(labels, ['KT', 'KT-K', 'K-T'])
    err_index = find_index(labels, ['DATA-ERR', 'D(DATA)', 'ERR', 'ERR-T', 'STAT-W G'])
    err_plus = find_index(labels, ['+DATA-ERR'])
    err_minus = find_index(labels, ['-DATA-ERR'])

    points = []
    for point_index, row in enumerate(getattr(dataset, 'data', [])[:max_points]):
        if not isinstance(row, (list, tuple)):
            continue
        value = to_num(row[data_index]) if data_index < len(row) else None
        if value is None:
            continue
        energy_ev, kt_kev = None, None
        if quantity == 'MACS':
            if kt_index is not None and kt_index < len(row):
                kt_kev = kt_to_kev(to_num(row[kt_index]), units[kt_index] if kt_index < len(units) else '')
        elif energy_index is not None and energy_index < len(row):
            energy_ev = energy_to_ev(to_num(row[energy_index]), units[energy_index] if energy_index < len(units) else '')
        uncertainty = None
        if err_index is not None and err_index < len(row):
            err_value = to_num(row[err_index])
            if err_value is not None:
                uncertainty = abs(err_value)
        elif err_plus is not None and err_minus is not None and err_plus < len(row) and err_minus < len(row):
            plus, minus = to_num(row[err_plus]), to_num(row[err_minus])
            if plus is not None and minus is not None:
                uncertainty = (abs(plus) + abs(minus)) / 2.0
        points.append((point_index, energy_ev, kt_kev, value, uncertainty))
    return points
