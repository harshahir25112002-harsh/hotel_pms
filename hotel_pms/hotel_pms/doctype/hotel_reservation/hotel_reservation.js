function validate_reservation_phone(phone) {
    let raw = (phone || "").toString().trim().replace(/[\s\-\(\)\+]/g, "");
    let clean = raw.replace(/\D/g, "");
    if (clean.length === 12 && clean.startsWith("91")) clean = clean.substring(2);
    if (clean.length === 11 && clean.startsWith("0")) clean = clean.substring(1);

    if (clean.length !== 10) {
        return { valid: false, message: __("Contact Phone must be exactly 10 digits (currently {0} digits).", [clean.length]) };
    }
    if (!/^[6-9]\d{9}$/.test(clean)) {
        return { valid: false, message: __("Invalid Mobile Number. As per TRAI standards, Indian mobile numbers must start with 6, 7, 8, or 9.") };
    }
    if (new Set(clean).size <= 1) {
        return { valid: false, message: __("Mobile number cannot consist of all identical digits.") };
    }
    return { valid: true, clean: clean };
}

frappe.ui.form.on("Hotel Reservation", {
    validate: function(frm) {
        if (frm.doc.contact_phone) {
            let res = validate_reservation_phone(frm.doc.contact_phone);
            if (!res.valid) {
                frappe.msgprint(res.message);
                frappe.validated = false;
                return;
            }
            frm.doc.contact_phone = res.clean;
        }

        if (frm.doc.arrival_date && frm.doc.departure_date) {
            if (frm.is_new() && frm.doc.arrival_date < frappe.datetime.get_today()) {
                frappe.msgprint(__("Arrival Date cannot be in the past."));
                frappe.validated = false;
                return;
            }
            if (frm.doc.departure_date <= frm.doc.arrival_date) {
                frappe.msgprint(__("Departure Date must be strictly after Arrival Date."));
                frappe.validated = false;
                return;
            }
        }
    },

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
