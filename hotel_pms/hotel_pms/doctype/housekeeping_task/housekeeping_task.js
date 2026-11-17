frappe.ui.form.on("Housekeeping Task", {
    refresh: function(frm) {
        if (!frm.is_new() && frm.doc.status !== "Completed" && frm.doc.status !== "Inspected") {
            frm.add_custom_button(__("Mark as Completed"), function() {
                frm.call({
                    method: "mark_completed",
                    callback: function(r) {
                        if (r.message && r.message.status === "success") {
                            frappe.msgprint(__("Task completed! Room {0} is now marked Vacant Clean.", [r.message.room]));
                            frm.reload_doc();
                        }
                    }
                });
            }).addClass("btn-primary");
        }
    }
});

