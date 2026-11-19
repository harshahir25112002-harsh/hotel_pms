frappe.ui.form.on("Hotel Stay", {
    validate: function(frm) {
        if (frm.doc.id_proof_type === "Aadhaar" && frm.doc.id_proof_number) {
            let clean = frm.doc.id_proof_number.replace(/\D/g, "");
            if (clean.length !== 12) {
                frappe.msgprint(__("Aadhaar Card number must be exactly 12 digits."));
                frappe.validated = false;
                return;
            }
            frm.doc.id_proof_number = clean;
        } else if (frm.doc.id_proof_type === "PAN" && frm.doc.id_proof_number) {
            let clean = frm.doc.id_proof_number.replace(/\s+/g, "").toUpperCase();
            if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(clean)) {
                frappe.msgprint(__("Invalid PAN Card format (expected e.g. ABCDE1234F)."));
                frappe.validated = false;
                return;
            }
            frm.doc.id_proof_number = clean;
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
            frm.set_df_property("id_proof_number", "placeholder", "12-digit Aadhaar Number");
        } else if (frm.doc.id_proof_type === "PAN") {
            frm.set_df_property("id_proof_number", "placeholder", "10-character PAN (e.g. ABCDE1234F)");
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
