// ==============================================================================
// Official UIDAI Verhoeff Checksum Tables (Dihedral Group D5)
// ==============================================================================
const VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];
const VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

function validate_verhoeff_js(str) {
    if (!str || !/^\d+$/.test(str)) return false;
    let c = 0;
    let reversed = str.split("").reverse().map(Number);
    for (let i = 0; i < reversed.length; i++) {
        c = VERHOEFF_D[c][VERHOEFF_P[i % 8][reversed[i]]];
    }
    return c === 0;
}

function validate_stay_aadhaar(aadhaar) {
    let clean = (aadhaar || "").toString().replace(/[\s\-]/g, "").replace(/\D/g, "");
    if (clean.length !== 12) {
        return { valid: false, message: __("Aadhaar must be exactly 12 digits (entered {0} digits).", [clean.length]) };
    }
    if (clean[0] === "0" || clean[0] === "1") {
        return { valid: false, message: __("Invalid Aadhaar: According to UIDAI guidelines, Aadhaar cannot start with 0 or 1.") };
    }
    if (new Set(clean).size <= 1) {
        return { valid: false, message: __("Invalid Aadhaar: Aadhaar cannot consist of all repeating identical digits.") };
    }
    if (!validate_verhoeff_js(clean)) {
        return { valid: false, message: __("Aadhaar failed UIDAI official Verhoeff checksum algorithm verification.") };
    }
    return { valid: true, clean: clean };
}

function validate_stay_pan(pan) {
    let clean = (pan || "").toString().trim().replace(/[\s\-]/g, "").toUpperCase();
    if (clean.length !== 10) {
        return { valid: false, message: __("PAN must be exactly 10 characters (e.g. ABCDE1234F).") };
    }
    if (!/^[A-Z]{3}[PCHABGJLFT][A-Z][0-9]{4}[A-Z]$/.test(clean)) {
        return { valid: false, message: __("Invalid PAN structure (expected e.g. ABCDE1234F with 4th char indicating entity status: P, C, H, F, A, T, B, L, J, G).") };
    }
    return { valid: true, clean: clean };
}

frappe.ui.form.on("Hotel Stay", {
    validate: function(frm) {
        if (frm.doc.id_proof_type === "Aadhaar" && frm.doc.id_proof_number) {
            let res = validate_stay_aadhaar(frm.doc.id_proof_number);
            if (!res.valid) {
                frappe.msgprint(res.message);
                frappe.validated = false;
                return;
            }
            frm.doc.id_proof_number = res.clean;
        } else if (frm.doc.id_proof_type === "PAN" && frm.doc.id_proof_number) {
            let res = validate_stay_pan(frm.doc.id_proof_number);
            if (!res.valid) {
                frappe.msgprint(res.message);
                frappe.validated = false;
                return;
            }
            frm.doc.id_proof_number = res.clean;
        }

        if (frm.doc.expected_checkout_date && frm.doc.checkin_date) {
            if (frappe.datetime.str_to_obj(frm.doc.expected_checkout_date) < frappe.datetime.str_to_obj(frm.doc.checkin_date)) {
                frappe.msgprint(__("Expected Checkout Date cannot be before Check-in Date."));
                frappe.validated = false;
                return;
            }
        }
    },

    id_proof_type: function(frm) {
        if (frm.doc.id_proof_type === "Aadhaar") {
            frm.set_df_property("id_proof_number", "placeholder", "12-digit Aadhaar Number (UIDAI Validated)");
        } else if (frm.doc.id_proof_type === "PAN") {
            frm.set_df_property("id_proof_number", "placeholder", "10-character PAN (e.g. ABCDE1234F)");
        }
    },

    id_proof_number: function(frm) {
        if (!frm.doc.id_proof_number) return;
        if (frm.doc.id_proof_type === "Aadhaar") {
            let res = validate_stay_aadhaar(frm.doc.id_proof_number);
            if (res.valid) {
                frappe.show_alert({ message: __("✓ UIDAI Checksum Verified (Valid Aadhaar)"), indicator: "green" });
                frm.set_value("id_proof_number", res.clean);
            }
        } else if (frm.doc.id_proof_type === "PAN") {
            let res = validate_stay_pan(frm.doc.id_proof_number);
            if (res.valid) {
                frappe.show_alert({ message: __("✓ Income Tax PAN Verified"), indicator: "green" });
                frm.set_value("id_proof_number", res.clean);
            }
        }
    },

    refresh: function(frm) {
        if (!frm.is_new() && frm.doc.status === "Active") {
            // View Folio button
            if (frm.doc.folio) {
                frm.add_custom_button(__("View Folio"), function() {
                    frappe.set_route("Form", "Guest Folio", frm.doc.folio);
                }, __("Billing"));
            }

            // Change Room button
            frm.add_custom_button(__("Change Room"), function() {
                let d = new frappe.ui.Dialog({
                    title: __("Move Guest to Another Room"),
                    fields: [
                        {
                            label: __("Current Room"),
                            fieldname: "current_room",
                            fieldtype: "Data",
                            default: frm.doc.room,
                            read_only: 1
                        },
                        {
                            label: __("New Room"),
                            fieldname: "new_room",
                            fieldtype: "Link",
                            options: "Hotel Room",
                            reqd: 1,
                            get_query: function() {
                                return {
                                    filters: {
                                        status: "Vacant Clean",
                                        is_active: 1
                                    }
                                };
                            }
                        },
                        {
                            label: __("Reason for Room Change"),
                            fieldname: "reason",
                            fieldtype: "Small Text",
                            reqd: 1
                        }
                    ],
                    primary_action_label: __("Move Room"),
                    primary_action: function(vals) {
                        frm.call({
                            doc: frm.doc,
                            method: "move_room",
                            args: {
                                stay: frm.doc.name,
                                new_room: vals.new_room,
                                reason: vals.reason
                            },
                            callback: function(r) {
                                d.hide();
                                frappe.msgprint(__("Guest successfully moved to Room {0}", [vals.new_room]));
                                frm.reload_doc();
                            }
                        });
                    }
                });
                d.show();
            }, __("Actions"));

            // Process Checkout button
            frm.add_custom_button(__("Process Checkout"), function() {
                frappe.confirm(__("Proceed to check out Stay {0} for Room {1}?", [frm.doc.name, frm.doc.room]), function() {
                    frm.call({
                        doc: frm.doc,
                        method: "process_checkout",
                        args: {
                            stay: frm.doc.name
                        },
                        callback: function(r) {
                            if (r.message && r.message.status === "success") {
                                frappe.msgprint(__("Stay checked out successfully! Invoice: {0}", [r.message.invoice || "N/A"]));
                                frm.reload_doc();
                            }
                        }
                    });
                });
            }, __("Actions")).addClass("btn-danger");
        }
    }
});
