frappe.ui.form.on("Night Audit", {
    refresh: function(frm) {
        if (!frm.is_new() && frm.doc.status !== "Completed") {
            frm.add_custom_button(__("Run Night Audit Now"), function() {
                frappe.confirm(__("Run Night Audit for {0}? This will post daily room charges and calculate hotel revenue metrics.", [frm.doc.audit_date]), function() {
                    frm.call({
                        doc: frm.doc,
                        method: "run_audit",
                        callback: function(r) {
                            if (r.message && r.message.status === "success") {
                                frappe.msgprint(__("Night Audit completed! Occupancy: {0}%, Revenue: {1}", [r.message.occupancy, r.message.total_revenue]));
                                frm.reload_doc();
                            }
                        }
                    });
                });
            }).addClass("btn-primary");
        }
    }
});

