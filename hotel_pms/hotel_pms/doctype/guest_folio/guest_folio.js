frappe.ui.form.on("Guest Folio", {
    refresh: function(frm) {
        if (!frm.is_new() && frm.doc.status === "Open") {
            // Button to Add Charge
            frm.add_custom_button(__("Add Charge"), function() {
                let d = new frappe.ui.Dialog({
                    title: __("Post Folio Charge"),
                    fields: [
                        {
                            label: __("Charge Type"),
                            fieldname: "charge_type",
                            fieldtype: "Select",
                            options: "Room Rent\nRestaurant / F&B\nLaundry\nMinibar\nExtra Bed\nLate Checkout\nOther",
                            reqd: 1,
                            default: "Restaurant / F&B"
                        },
                        {
                            label: __("Description"),
                            fieldname: "description",
                            fieldtype: "Data"
                        },
                        {
                            label: __("Rate"),
                            fieldname: "rate",
                            fieldtype: "Currency",
                            reqd: 1
                        },
                        {
                            label: __("Qty"),
                            fieldname: "qty",
                            fieldtype: "Float",
                            default: 1,
                            reqd: 1
                        }
                    ],
                    primary_action_label: __("Post Charge"),
                    primary_action: function(values) {
                        values.folio = frm.doc.name;
                        frm.call({
                            doc: frm.doc,
                            method: "add_charge",
                            args: values,
                            callback: function(r) {
                                d.hide();
                                frm.reload_doc();
                            }
                        });
                    }
                });
                d.show();
            }, __("Actions"));

            // Button to Create Payment Entry
            if (frm.doc.outstanding_balance > 0) {
                frm.add_custom_button(__("Receive Payment"), function() {
                    frappe.new_doc("Payment Entry", {
                        payment_type: "Receive",
                        party_type: "Customer",
                        party: frm.doc.guest,
                        paid_amount: frm.doc.outstanding_balance,
                        received_amount: frm.doc.outstanding_balance,
                        hotel_stay: frm.doc.stay
                    });
                }, __("Actions"));
            }

            // Button to Settle & Create Sales Invoice
            if (!frm.doc.sales_invoice && frm.doc.charges && frm.doc.charges.length > 0) {
                frm.add_custom_button(__("Generate Sales Invoice"), function() {
                    frappe.confirm(__("Generate Sales Invoice and Settle this Folio?"), function() {
                        frm.call({
                            doc: frm.doc,
                            method: "create_sales_invoice",
                            args: {
                                folio: frm.doc.name
                            },
                            callback: function(r) {
                                if (r.message) {
                                    frappe.msgprint(__("Sales Invoice {0} generated successfully.", [r.message]));
                                    frm.reload_doc();
                                }
                            }
                        });
                    });
                }, __("Actions")).addClass("btn-primary");
            }
        }
    }
});
