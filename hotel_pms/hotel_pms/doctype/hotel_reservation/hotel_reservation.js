frappe.ui.form.on("Hotel Reservation", {
    refresh: function(frm) {
        if (!frm.is_new()) {
            // Check-In button available for Draft or Confirmed
            if (frm.doc.status === "Confirmed" || frm.doc.status === "Draft") {
                frm.add_custom_button(__("Check-In"), function() {
                    frappe.confirm(__("Proceed to Check-In for room {0}?", [frm.doc.assigned_room || frm.doc.room_type]), function() {
                        frm.call({
                            doc: frm.doc,
                            method: "create_check_in",
                            args: {
                                reservation: frm.doc.name,
                                room: frm.doc.assigned_room
                            },
                            callback: function(r) {
                                if (r.message) {
                                    frappe.msgprint(__("Checked in successfully! Hotel Stay created: {0}", [r.message]));
                                    frappe.set_route("Form", "Hotel Stay", r.message);
                                }
                            }
                        });
                    });
                }).addClass("btn-primary");
            }

            // Record Advance Payment button
            if (frm.doc.payment_status !== "Fully Paid" && frm.doc.status !== "Cancelled") {
                frm.add_custom_button(__("Record Advance Payment"), function() {
                    frappe.new_doc("Payment Entry", {
                        payment_type: "Receive",
                        party_type: "Customer",
                        party: frm.doc.guest,
                        paid_amount: frm.doc.estimated_total - frm.doc.advance_paid,
                        received_amount: frm.doc.estimated_total - frm.doc.advance_paid,
                        hotel_reservation: frm.doc.name
                    });
                }, __("Actions"));
            }
        }
    },

    room_type: function(frm) {
        if (frm.doc.room_type && !frm.doc.room_rate) {
            frappe.db.get_value("Hotel Room Type", frm.doc.room_type, "base_rate", function(r) {
                if (r && r.base_rate) {
                    frm.set_value("room_rate", r.base_rate);
                }
            });
        }
    },

    departure_date: function(frm) {
        if (frm.doc.arrival_date && frm.doc.departure_date) {
            let nights = frappe.datetime.get_diff(frm.doc.departure_date, frm.doc.arrival_date);
            frm.set_value("nights", nights > 0 ? nights : 1);
            frm.set_value("estimated_total", (frm.doc.room_rate || 0) * (nights > 0 ? nights : 1));
        }
    }
});
