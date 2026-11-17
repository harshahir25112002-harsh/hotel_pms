frappe.ui.form.on("Hotel Stay", {
    refresh: function(frm) {
        if (!frm.is_new() && frm.doc.docstatus === 1 && frm.doc.status === "Active") {
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
                            method: "move_room",
                            args: {
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
                        method: "process_checkout",
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

