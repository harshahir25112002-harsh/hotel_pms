# Copyright (c) 2026, Hotel PMS and contributors
# For license information, please see license.txt

import re
import frappe
from frappe import _

# ==============================================================================
# UIDAI Official Verhoeff Checksum Tables (Dihedral Group D5)
# Used by the Unique Identification Authority of India (UIDAI) for Aadhaar
# ==============================================================================
VERHOEFF_D = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
    (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
    (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
    (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
    (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)

VERHOEFF_P = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
    (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
    (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
    (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)

VERHOEFF_INV = (0, 4, 3, 2, 1, 5, 6, 7, 8, 9)

def validate_verhoeff(num_str: str) -> bool:
    """
    Validate a number against the Verhoeff algorithm.
    Used by UIDAI for official Aadhaar number checksum calculation.
    """
    if not num_str or not str(num_str).strip().isdigit():
        return False
    c = 0
    # Process digits in reverse order (index 0 is the check digit at the far right)
    for i, digit in enumerate(reversed(str(num_str).strip())):
        c = VERHOEFF_D[c][VERHOEFF_P[i % 8][int(digit)]]
    return c == 0

def generate_verhoeff(num_str: str) -> str:
    """Generate the full number including the Verhoeff check digit"""
    c = 0
    for i, digit in enumerate(reversed(str(num_str).strip())):
        c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][int(digit)]]
    return str(num_str).strip() + str(VERHOEFF_INV[c])

# ==============================================================================
# Aadhaar Number Validation (UIDAI Rules)
# ==============================================================================
def validate_aadhaar(aadhaar: str) -> str:
    """
    Validates Indian Aadhaar Number based on UIDAI specifications:
    1. Exactly 12 digits.
    2. Cannot begin with '0' or '1' (UIDAI standard).
    3. Cannot be all identical repeating digits.
    4. Must satisfy the Verhoeff Dihedral D5 checksum algorithm.
    """
    if not aadhaar or not str(aadhaar).strip():
        frappe.throw(_("Aadhaar Number is required."))

    raw = str(aadhaar).strip().replace(" ", "").replace("-", "")
    clean = re.sub(r"\D", "", raw)

    if len(clean) != 12:
        frappe.throw(
            _("Invalid Aadhaar Number '{0}'. Aadhaar must contain exactly 12 digits (entered {1} digits).")
            .format(aadhaar, len(clean))
        )

    if clean[0] in ("0", "1"):
        frappe.throw(
            _("Invalid Aadhaar Number '{0}'. As per UIDAI guidelines, Aadhaar numbers cannot start with 0 or 1.")
            .format(aadhaar)
        )

    if len(set(clean)) <= 1:
        frappe.throw(
            _("Invalid Aadhaar Number '{0}'. Aadhaar number cannot consist of all repeating identical digits.")
            .format(aadhaar)
        )

    if not validate_verhoeff(clean):
        frappe.throw(
            _("Aadhaar Number '{0}' failed UIDAI official Verhoeff checksum validation. Please verify the 12-digit number from the original Aadhaar Card.")
            .format(aadhaar)
        )

    return clean

# ==============================================================================
# Indian Mobile Number Validation (TRAI Rules)
# ==============================================================================
def validate_mobile_number(phone: str, mandatory: bool = False) -> str:
    """
    Validates Indian Mobile Numbers according to TRAI (Telecom Regulatory Authority of India):
    1. 10 digits in length.
    2. First digit must be 6, 7, 8, or 9.
    3. Handles and strips country code (+91, 91) or trunk prefix (0).
    4. Rejects dummy repeating numbers (e.g. 9999999999).
    """
    if not phone or not str(phone).strip():
        if mandatory:
            frappe.throw(_("Guest Mobile Number is mandatory."))
        return ""

    raw = str(phone).strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "").replace("+", "")
    clean = re.sub(r"\D", "", raw)

    # Strip country code 91 if 12 digits
    if len(clean) == 12 and clean.startswith("91"):
        clean = clean[2:]
    # Strip trunk prefix 0 if 11 digits
    elif len(clean) == 11 and clean.startswith("0"):
        clean = clean[1:]

    if len(clean) != 10:
        frappe.throw(
            _("Invalid Mobile Number '{0}'. Indian mobile numbers must be exactly 10 digits (entered {1} digits).")
            .format(phone, len(clean))
        )

    if not re.match(r"^[6-9]\d{9}$", clean):
        frappe.throw(
            _("Invalid Mobile Number '{0}'. As per TRAI standards, Indian mobile numbers must start with 6, 7, 8, or 9.")
            .format(phone)
        )

    if len(set(clean)) <= 1:
        frappe.throw(
            _("Invalid Mobile Number '{0}'. Mobile number cannot consist of all identical digits.")
            .format(phone)
        )

    return clean

# ==============================================================================
# PAN Card Validation (Income Tax Department Rules)
# ==============================================================================
# 4th character denotes entity status:
# P: Individual | C: Company | H: HUF | A: AOP | B: BOI | G: Govt | J: Artificial Juridical Person | L: Local Authority | F: Firm/LLP | T: Trust
PAN_ENTITY_TYPES = {
    "P": "Individual",
    "C": "Company",
    "H": "Hindu Undivided Family",
    "A": "Association of Persons",
    "B": "Body of Individuals",
    "G": "Government Agency",
    "J": "Artificial Juridical Person",
    "L": "Local Authority",
    "F": "Firm / LLP",
    "T": "Trust",
}

def validate_pan(pan: str) -> str:
    """
    Validates Indian Permanent Account Number (PAN) according to Income Tax Department:
    Format: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).
    4th character must be one of the recognized entity status codes (P, C, H, A, B, G, J, L, F, T).
    """
    if not pan or not str(pan).strip():
        frappe.throw(_("PAN Number is required."))

    clean = str(pan).strip().replace(" ", "").replace("-", "").upper()

    if len(clean) != 10:
        frappe.throw(
            _("Invalid PAN Number '{0}'. PAN must be exactly 10 characters (e.g. ABCDE1234F).")
            .format(pan)
        )

    pan_regex = r"^[A-Z]{3}[PCHABGJLFT][A-Z][0-9]{4}[A-Z]$"
    if not re.match(pan_regex, clean):
        fourth_char = clean[3] if len(clean) > 3 else ""
        if fourth_char and fourth_char not in PAN_ENTITY_TYPES:
            frappe.throw(
                _("Invalid PAN '{0}'. The 4th character '{1}' is not a valid Income Tax entity type (expected P, C, H, F, A, T, B, L, J, or G).")
                .format(pan, fourth_char)
            )
        frappe.throw(
            _("Invalid PAN format '{0}'. Official PAN structure must be: 5 letters (e.g. ABCDE), 4 digits (e.g. 1234), and 1 letter (e.g. F).")
            .format(pan)
        )

    return clean

# ==============================================================================
# Passport, Voter ID & Driving License Validations
# ==============================================================================
def validate_passport(passport: str) -> str:
    if not passport or not str(passport).strip():
        frappe.throw(_("Passport Number is required."))

    clean = str(passport).strip().replace(" ", "").upper()
    if len(clean) < 6 or len(clean) > 15 or not clean.isalnum():
        frappe.throw(_("Invalid Passport Number '{0}'. Must be 6-15 alphanumeric characters.").format(passport))

    # Standard Indian Passport: 1 letter followed by 7 digits
    if len(clean) == 8 and re.match(r"^[A-Z][0-9]{7}$", clean):
        return clean
    # International Passport: 6-12 alphanumeric characters
    if re.match(r"^[A-Z0-9]{6,15}$", clean):
        return clean

    frappe.throw(_("Invalid Passport Number format '{0}'.").format(passport))
    return clean

def validate_driving_license(dl: str) -> str:
    if not dl or not str(dl).strip():
        frappe.throw(_("Driving License Number is required."))

    clean = str(dl).strip().replace(" ", "").replace("-", "").upper()
    if len(clean) < 8 or len(clean) > 20 or not clean.isalnum():
        frappe.throw(_("Invalid Driving License Number '{0}'. Must be 8-20 alphanumeric characters.").format(dl))

    return clean

def validate_voter_id(voter_id: str) -> str:
    if not voter_id or not str(voter_id).strip():
        frappe.throw(_("Voter ID is required."))

    clean = str(voter_id).strip().replace(" ", "").replace("-", "").upper()
    if len(clean) < 8 or len(clean) > 16 or not clean.isalnum():
        frappe.throw(_("Invalid Voter ID Number '{0}'. Must be 8-16 alphanumeric characters.").format(voter_id))

    return clean

# ==============================================================================
# Universal KYC Dispatcher
# ==============================================================================
def validate_kyc_document(doc_type: str, doc_number: str) -> str:
    """Dispatches to the specific government validation algorithm"""
    if not doc_type and not doc_number:
        return ""
    if doc_type and not doc_number:
        frappe.throw(_("ID Proof Number is required when ID Proof Type is selected."))
    if doc_number and not doc_type:
        frappe.throw(_("Please select ID Proof Type for the entered ID Number."))

    doc_type = str(doc_type).strip()
    doc_number = str(doc_number).strip()

    if doc_type == "Aadhaar":
        return validate_aadhaar(doc_number)
    elif doc_type == "PAN":
        return validate_pan(doc_number)
    elif doc_type == "Passport":
        return validate_passport(doc_number)
    elif doc_type == "Driving License":
        return validate_driving_license(doc_number)
    elif doc_type == "Voter ID":
        return validate_voter_id(doc_number)
    else:
        # Other ID types: minimum 4 characters alphanumeric
        clean = doc_number.replace(" ", "").upper()
        if len(clean) < 3:
            frappe.throw(_("ID Proof Number '{0}' is too short.").format(doc_number))
        return clean

# ==============================================================================
# Whitelisted Endpoint for Live AJAX Frontend Verification
# ==============================================================================
@frappe.whitelist()
def verify_government_id(id_type: str, id_number: str):
    """
    Provides real-time validation response for dashboard modals & forms.
    Returns: { valid: bool, message: str, clean_number: str }
    """
    try:
        clean = validate_kyc_document(id_type, id_number)
        label = id_type
        if id_type == "Aadhaar":
            label = "Aadhaar (UIDAI Verhoeff Checksum Verified)"
        elif id_type == "PAN":
            fourth = clean[3] if len(clean) > 3 else "P"
            entity = PAN_ENTITY_TYPES.get(fourth, "Taxpayer")
            label = f"PAN ({entity} - Format Verified)"

        return {
            "valid": True,
            "message": _("✓ Valid {0}").format(label),
            "clean_number": clean
        }
    except Exception as e:
        msg = str(e)
        # Strip frappe html error prefixes
        if "frappe.exceptions.ValidationError:" in msg:
            msg = msg.split("frappe.exceptions.ValidationError:")[-1].strip()
        return {
            "valid": False,
            "message": msg
        }
