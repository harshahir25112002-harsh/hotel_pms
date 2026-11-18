frappe.pages["hotel_dashboard"].on_page_load = function(wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Hotel Front Desk & Room Rack"),
        single_column: true
    });

    wrapper.hotel_dashboard = new HotelDashboard(page);
};

class HotelDashboard {
    constructor(page) {
        this.page = page;
        this.selected_date = frappe.datetime.get_today();
        this.active_filter = "All";
        this.init();
    }

    init() {
        this.setup_header_actions();
        this.setup_dom();
        this.load_data();
    }

    setup_header_actions() {
        // Quick Walk-In Check-In button (prominent green button)
        this.page.set_primary_action(__("+ Quick Check-In"), () => {
            this.open_quick_checkin_dialog();
        }, "octicon octicon-check");

        // Today Date shortcut
        this.page.set_secondary_action(__("Today"), () => {
            this.selected_date = frappe.datetime.get_today();
            this.page.get_field("dashboard_date").set_value(this.selected_date);
            this.load_data();
        });

        // Date Picker field
        this.page.add_field({
            fieldname: "dashboard_date",
            label: __("Date"),
            fieldtype: "Date",
            default: this.selected_date,
            change: () => {
                let val = this.page.get_field("dashboard_date").get_value();
                if (val) {
                    this.selected_date = val;
                    this.load_data();
                }
            }
        });

        // New Reservation
        this.page.add_button(__("New Reservation"), () => {
            frappe.new_doc("Hotel Reservation", {
                arrival_date: this.selected_date
            });
        });

        // Run Night Audit
        this.page.add_button(__("Run Night Audit"), () => {
            frappe.confirm(__("Run Night Audit for {0}? This will post daily room charges.", [this.selected_date]), () => {
                frappe.call({
                    method: "hotel_pms.hotel_pms.doctype.night_audit.night_audit.execute_daily_night_audit",
                    callback: (r) => {
                        frappe.show_alert({ message: __("Night Audit completed!"), indicator: "green" });
                        this.load_data();
                    }
                });
            });
        });

        // Refresh
        this.page.add_button(__("Refresh"), () => {
            this.load_data();
        });
    }

    setup_dom() {
        this.$wrapper = $(`
            <div class="hotel-dashboard-container">
                <!-- KPI Row -->
                <div class="kpi-grid" id="kpi-cards"></div>

                <!-- Section Toolbar & Filters -->
                <div class="section-toolbar">
                    <div class="matrix-filter-pills" id="status-filters">
                        <button class="filter-pill active" data-filter="All">${__("All Rooms")}</button>
                        <button class="filter-pill pill-clean" data-filter="Vacant Clean">🟢 ${__("Vacant Clean")}</button>
                        <button class="filter-pill pill-dirty" data-filter="Vacant Dirty">🟡 ${__("Vacant Dirty")}</button>
                        <button class="filter-pill pill-occupied" data-filter="Occupied">🟣 ${__("Occupied")}</button>
                        <button class="filter-pill pill-ooo" data-filter="Out of Order">⚪ ${__("Out of Order")}</button>
                    </div>
                </div>

                <!-- Room Rack Grid -->
                <div class="room-grid" id="room-matrix"></div>

                <!-- Operations Tabs -->
                <div class="dash-tabs-container">
                    <div class="dash-tabs">
                        <div class="dash-tab active" data-tab="arrivals">
                            🛬 ${__("Today's Arrivals")} <span class="tab-badge" id="badge-arrivals">0</span>
                        </div>
                        <div class="dash-tab" data-tab="departures">
                            🛫 ${__("Today's Departures")} <span class="tab-badge" id="badge-departures">0</span>
                        </div>
                        <div class="dash-tab" data-tab="housekeeping">
                            🧹 ${__("Housekeeping Queue")} <span class="tab-badge" id="badge-hk">0</span>
                        </div>
                    </div>
                    <div class="tab-pane active" id="pane-arrivals"></div>
                    <div class="tab-pane" id="pane-departures"></div>
                    <div class="tab-pane" id="pane-housekeeping"></div>
                </div>
            </div>
        `).appendTo(this.page.main);

        this.bind_events();
    }

    bind_events() {
        // Filter pills click
        this.$wrapper.on("click", ".filter-pill", (e) => {
            this.$wrapper.find(".filter-pill").removeClass("active");
            $(e.currentTarget).addClass("active");
            this.active_filter = $(e.currentTarget).data("filter");
            this.render_rooms();
        });

        // Tabs switch
        this.$wrapper.on("click", ".dash-tab", (e) => {
            let tab = $(e.currentTarget).data("tab");
            this.$wrapper.find(".dash-tab").removeClass("active");
            this.$wrapper.find(".tab-pane").removeClass("active");
            $(e.currentTarget).addClass("active");
            this.$wrapper.find(`#pane-${tab}`).addClass("active");
        });

        // 1-Click Clean Room button on cards
        this.$wrapper.on("click", ".btn-mark-clean", (e) => {
            e.stopPropagation();
            let room = $(e.currentTarget).data("room");
            this.mark_clean(room);
        });

        // 1-Click Check-In button on clean cards
        this.$wrapper.on("click", ".btn-card-checkin", (e) => {
            e.stopPropagation();
            let room = $(e.currentTarget).data("room");
            let rate = $(e.currentTarget).data("rate");
            this.open_quick_checkin_dialog(room, rate);
        });

        // Room card click (smart interaction based on room state)
        this.$wrapper.on("click", ".room-card", (e) => {
            let room = $(e.currentTarget).data("room");
            let status = $(e.currentTarget).data("status");
            let stay = $(e.currentTarget).data("stay");

            if (status === "Vacant Clean") {
                this.open_quick_checkin_dialog(room);
            } else if (status === "Occupied") {
                this.open_inhouse_dialog(room, stay);
            } else if (status === "Vacant Dirty") {
                frappe.confirm(__("Room {0} is dirty. Mark it Clean now?", [room]), () => {
                    this.mark_clean(room);
                });
            } else {
                frappe.set_route("Form", "Hotel Room", room);
            }
        });
    }

    load_data() {
        frappe.call({
            method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.get_dashboard_data",
            args: { selected_date: this.selected_date },
            callback: (r) => {
                if (r.message) {
                    this.data = r.message;
                    this.render_kpis();
                    this.render_rooms();
                    this.render_arrivals();
                    this.render_departures();
                    this.render_housekeeping();
                }
            }
        });
    }

    render_kpis() {
        let k = this.data.kpis;
        let currency = frappe.defaults.get_default("currency") || "₹";

        let html = `
            <div class="kpi-card kpi-occupancy">
                <div class="kpi-title">${__("Occupancy Rate")}</div>
                <div class="kpi-value">${k.occupancy_pct}%</div>
                <div class="kpi-sub">${k.occupied} / ${k.total_rooms} ${__("Rooms Occupied")}</div>
            </div>
            <div class="kpi-card kpi-clean">
                <div class="kpi-title">${__("Vacant Clean")}</div>
                <div class="kpi-value">${k.vacant_clean}</div>
                <div class="kpi-sub">${__("Ready for Guests")}</div>
            </div>
            <div class="kpi-card kpi-dirty">
                <div class="kpi-title">${__("Vacant Dirty")}</div>
                <div class="kpi-value">${k.vacant_dirty}</div>
                <div class="kpi-sub">${__("Needs Cleaning")}</div>
            </div>
            <div class="kpi-card kpi-occupied">
                <div class="kpi-title">${__("In-House Guests")}</div>
                <div class="kpi-value">${k.occupied}</div>
                <div class="kpi-sub">${__("Active Stays")}</div>
            </div>
            <div class="kpi-card kpi-revenue">
                <div class="kpi-title">${__("Today's Revenue")}</div>
                <div class="kpi-value">${format_currency(k.today_revenue, currency)}</div>
                <div class="kpi-sub">ADR: ${format_currency(k.adr, currency)}</div>
            </div>
            <div class="kpi-card kpi-dues">
                <div class="kpi-title">${__("Pending Dues")}</div>
                <div class="kpi-value">${format_currency(k.total_unpaid, currency)}</div>
                <div class="kpi-sub">${__("Uncollected Balances")}</div>
            </div>
        `;
        this.$wrapper.find("#kpi-cards").html(html);

        this.$wrapper.find("#badge-arrivals").text(k.arrivals_count);
        this.$wrapper.find("#badge-departures").text(k.departures_count);
        this.$wrapper.find("#badge-hk").text(k.hk_pending_count);
    }

    render_rooms() {
        let rooms = this.data.rooms || [];
        if (this.active_filter !== "All") {
            rooms = rooms.filter(r => r.status === this.active_filter);
        }

        let html = "";
        let currency = frappe.defaults.get_default("currency") || "₹";

        rooms.forEach(r => {
            let status_class = "status-" + r.status.toLowerCase().replace(/ /g, "-");
            let badge_class = "badge-clean";
            if (r.status === "Vacant Dirty") badge_class = "badge-dirty";
            if (r.status === "Occupied") badge_class = "badge-occupied";
            if (r.status === "Out of Order") badge_class = "badge-ooo";

            html += `
                <div class="room-card ${status_class}" data-room="${r.room}" data-stay="${r.stay_name || ''}" data-status="${r.status}">
                    <div>
                        <div class="room-card-header">
                            <span class="room-number">${r.room_number}</span>
                            <span class="room-badge ${badge_class}">${r.status}</span>
                        </div>
                        <div class="room-type">${r.room_type} · Floor ${r.floor}</div>
                        ${r.guest_name ? `
                            <div class="room-guest">👤 ${frappe.utils.escape_html(r.guest_name)}</div>
                            <div class="room-dates">Checkout: <strong>${r.expected_checkout || 'N/A'}</strong></div>
                            ${r.folio_balance > 0 ? `<div class="room-folio-bal">Due: ${format_currency(r.folio_balance, currency)}</div>` : '<div class="text-success text-xs font-bold">✓ Settled</div>'}
                        ` : ''}
                    </div>

                    <div class="room-actions">
                        ${r.status === 'Vacant Clean' ? `
                            <button class="room-btn-sm btn-checkin btn-card-checkin" data-room="${r.room}">⚡ ${__("Check-In")}</button>
                        ` : ''}
                        ${r.status === 'Vacant Dirty' ? `
                            <button class="room-btn-sm btn-clean btn-mark-clean" data-room="${r.room}">✓ ${__("Mark Clean")}</button>
                        ` : ''}
                        ${r.status === 'Occupied' && r.folio_name ? `
                            <button class="room-btn-sm btn-folio" onclick="event.stopPropagation(); frappe.set_route('Form', 'Guest Folio', '${r.folio_name}')">🧾 ${__("Folio")}</button>
                        ` : ''}
                    </div>
                </div>
            `;
        });

        if (rooms.length === 0) {
            html = `<div class="text-muted p-4 col-span-full">${__("No rooms match this filter.")}</div>`;
        }

        this.$wrapper.find("#room-matrix").html(html);
    }

    render_arrivals() {
        let arrivals = this.data.arrivals || [];
        if (arrivals.length === 0) {
            this.$wrapper.find("#pane-arrivals").html(`<div class="text-muted p-3">${__("No expected arrivals for this date.")}</div>`);
            return;
        }

        let html = `
            <table class="dash-table">
                <thead>
                    <tr>
                        <th>${__("Guest Name")}</th>
                        <th>${__("Room Type")}</th>
                        <th>${__("Assigned Room")}</th>
                        <th>${__("Nights")}</th>
                        <th>${__("Est. Total")}</th>
                        <th>${__("Advance Paid")}</th>
                        <th>${__("Action")}</th>
                    </tr>
                </thead>
                <tbody>
        `;

        arrivals.forEach(a => {
            html += `
                <tr>
                    <td><strong>${frappe.utils.escape_html(a.guest_name)}</strong><br><small class="text-muted">${a.contact_phone || ''}</small></td>
                    <td>${a.room_type}</td>
                    <td><span class="badge ${a.assigned_room ? 'badge-primary' : 'badge-warning'}">${a.assigned_room || __('Not Assigned')}</span></td>
                    <td>${a.nights}</td>
                    <td>${format_currency(a.estimated_total)}</td>
                    <td><span class="badge ${a.advance_paid > 0 ? 'badge-success' : 'badge-secondary'}">${format_currency(a.advance_paid)}</span></td>
                    <td>
                        <button class="btn btn-xs btn-primary btn-arrival-checkin" data-res="${a.name}" data-room="${a.assigned_room || ''}">
                            ⚡ ${__("Check-in")}
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        this.$wrapper.find("#pane-arrivals").html(html);

        // Bind arrivals 1-click checkin
        this.$wrapper.find(".btn-arrival-checkin").on("click", (e) => {
            let res = $(e.currentTarget).data("res");
            let room = $(e.currentTarget).data("room");
            this.checkin_arrival(res, room);
        });
    }

    render_departures() {
        let departures = this.data.departures || [];
        if (departures.length === 0) {
            this.$wrapper.find("#pane-departures").html(`<div class="text-muted p-3">${__("No scheduled departures for this date.")}</div>`);
            return;
        }

        let html = `
            <table class="dash-table">
                <thead>
                    <tr>
                        <th>${__("Guest Name")}</th>
                        <th>${__("Room")}</th>
                        <th>${__("Check-in Date")}</th>
                        <th>${__("Folio Balance")}</th>
                        <th>${__("Action")}</th>
                    </tr>
                </thead>
                <tbody>
        `;

        departures.forEach(d => {
            html += `
                <tr>
                    <td><strong>${frappe.utils.escape_html(d.guest_name)}</strong></td>
                    <td><span class="badge badge-primary font-bold">Room ${d.room}</span></td>
                    <td>${d.checkin_date}</td>
                    <td><strong class="${d.balance > 0 ? 'text-danger' : 'text-success'}">${format_currency(d.balance)}</strong></td>
                    <td>
                        <button class="btn btn-xs btn-danger btn-departure-checkout" data-stay="${d.name}" data-room="${d.room}" data-balance="${d.balance}" data-folio="${d.folio || ''}">
                            🚪 ${__("Checkout")}
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        this.$wrapper.find("#pane-departures").html(html);

        this.$wrapper.find(".btn-departure-checkout").on("click", (e) => {
            let stay = $(e.currentTarget).data("stay");
            let room = $(e.currentTarget).data("room");
            let balance = parseFloat($(e.currentTarget).data("balance")) || 0;
            let folio = $(e.currentTarget).data("folio");

            if (balance > 0) {
                frappe.msgprint({
                    title: __("Unsettled Dues"),
                    indicator: "orange",
                    message: __("Guest in Room {0} has an outstanding balance of {1}. Please settle the folio first.", [room, format_currency(balance)]),
                    primary_action: {
                        label: __("Open Folio"),
                        action: () => frappe.set_route("Form", "Guest Folio", folio)
                    }
                });
            } else {
                frappe.confirm(__("Checkout Room {0}?", [room]), () => {
                    this.process_checkout(stay);
                });
            }
        });
    }

    render_housekeeping() {
        let tasks = this.data.housekeeping || [];
        if (tasks.length === 0) {
            this.$wrapper.find("#pane-housekeeping").html(`<div class="text-muted p-3">${__("All rooms are clean! No pending cleaning tasks.")}</div>`);
            return;
        }

        let html = `
            <table class="dash-table">
                <thead>
                    <tr>
                        <th>${__("Room")}</th>
                        <th>${__("Task Type")}</th>
                        <th>${__("Priority")}</th>
                        <th>${__("Assigned Staff")}</th>
                        <th>${__("Action")}</th>
                    </tr>
                </thead>
                <tbody>
        `;

        tasks.forEach(t => {
            html += `
                <tr>
                    <td><strong>Room ${t.room}</strong></td>
                    <td>${t.task_type}</td>
                    <td><span class="badge ${t.priority === 'High' || t.priority === 'Urgent' ? 'badge-danger' : 'badge-warning'}">${t.priority}</span></td>
                    <td>${t.assigned_to || __('Unassigned')}</td>
                    <td>
                        <button class="btn btn-xs btn-success btn-mark-clean" data-room="${t.room}">
                            ✓ ${__("Mark Clean")}
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        this.$wrapper.find("#pane-housekeeping").html(html);
    }

    // Modal: 1-Click Walk-In Check-In
    open_quick_checkin_dialog(preselected_room = null, default_rate = null) {
        let d = new frappe.ui.Dialog({
            title: __("⚡ Quick Walk-In Check-In"),
            fields: [
                {
                    label: __("Guest Name"),
                    fieldname: "guest_name",
                    fieldtype: "Data",
                    reqd: 1,
                    description: __("Type customer name. Will auto-create if new.")
                },
                {
                    label: __("Mobile Number"),
                    fieldname: "phone",
                    fieldtype: "Data"
                },
                {
                    fieldtype: "Column Break"
                },
                {
                    label: __("Room"),
                    fieldname: "room",
                    fieldtype: "Link",
                    options: "Hotel Room",
                    default: preselected_room,
                    reqd: 1,
                    get_query: () => {
                        return {
                            filters: {
                                status: "Vacant Clean",
                                is_active: 1
                            }
                        };
                    },
                    change: () => {
                        let selected_room = d.get_value("room");
                        if (selected_room) {
                            frappe.db.get_value("Hotel Room", selected_room, "room_type", (r) => {
                                if (r && r.room_type) {
                                    frappe.db.get_value("Hotel Room Type", r.room_type, "base_rate", (rt) => {
                                        if (rt && rt.base_rate) {
                                            d.set_value("room_rate", rt.base_rate);
                                        }
                                    });
                                }
                            });
                        }
                    }
                },
                {
                    label: __("Daily Room Rate"),
                    fieldname: "room_rate",
                    fieldtype: "Currency",
                    default: default_rate,
                    reqd: 1
                },
                {
                    fieldtype: "Section Break",
                    label: __("Stay Duration & Advance")
                },
                {
                    label: __("Check-In Date"),
                    fieldname: "checkin_date",
                    fieldtype: "Date",
                    default: this.selected_date,
                    reqd: 1
                },
                {
                    fieldtype: "Column Break"
                },
                {
                    label: __("Expected Checkout Date"),
                    fieldname: "expected_checkout_date",
                    fieldtype: "Date",
                    default: frappe.datetime.add_days(this.selected_date, 1),
                    reqd: 1
                },
                {
                    fieldtype: "Section Break"
                },
                {
                    label: __("Advance Payment (₹)"),
                    fieldname: "advance_amount",
                    fieldtype: "Currency",
                    default: 0
                },
                {
                    fieldtype: "Column Break"
                },
                {
                    label: __("Payment Mode"),
                    fieldname: "mode_of_payment",
                    fieldtype: "Link",
                    options: "Mode of Payment"
                }
            ],
            primary_action_label: __("Complete Check-In"),
            primary_action: (values) => {
                frappe.call({
                    method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.quick_walkin_checkin",
                    args: values,
                    freeze: true,
                    freeze_message: __("Checking in guest and setting up folio..."),
                    callback: (r) => {
                        if (r.message && r.message.status === "success") {
                            d.hide();
                            frappe.show_alert({
                                message: __("Guest {0} successfully checked in to Room {1}!", [r.message.guest, r.message.room]),
                                indicator: "green"
                            });
                            this.load_data();
                        }
                    }
                });
            }
        });

        // Trigger rate auto-fill if preselected room exists
        if (preselected_room && !default_rate) {
            frappe.db.get_value("Hotel Room", preselected_room, "room_type", (r) => {
                if (r && r.room_type) {
                    frappe.db.get_value("Hotel Room Type", r.room_type, "base_rate", (rt) => {
                        if (rt && rt.base_rate) {
                            d.set_value("room_rate", rt.base_rate);
                        }
                    });
                }
            });
        }

        d.show();
    }

    // Modal: In-House Room Details & Actions
    open_inhouse_dialog(room, stay) {
        let r_info = (this.data.rooms || []).find(x => x.room === room);
        if (!r_info) return;

        let d = new frappe.ui.Dialog({
            title: __("Room {0} · In-House Guest", [room]),
            fields: [
                {
                    fieldtype: "HTML",
                    options: `
                        <div style="padding: 10px 0; font-size: 14px; line-height: 1.8;">
                            <div><strong>Guest Name:</strong> ${frappe.utils.escape_html(r_info.guest_name || 'N/A')}</div>
                            <div><strong>Room Type:</strong> ${r_info.room_type} (Floor ${r_info.floor})</div>
                            <div><strong>Check-In:</strong> ${r_info.checkin_date || 'N/A'}</div>
                            <div><strong>Expected Checkout:</strong> ${r_info.expected_checkout || 'N/A'}</div>
                            <div style="margin-top: 8px; font-size: 16px;">
                                <strong>Folio Balance:</strong> 
                                <span class="${r_info.folio_balance > 0 ? 'text-danger font-bold' : 'text-success font-bold'}">
                                    ${format_currency(r_info.folio_balance)}
                                </span>
                            </div>
                        </div>
                    `
                }
            ]
        });

        // Add action buttons inside dialog
        if (r_info.folio_name) {
            d.add_custom_action(__("🧾 View Folio"), () => {
                d.hide();
                frappe.set_route("Form", "Guest Folio", r_info.folio_name);
            });
        }

        d.add_custom_action(__("🔄 Change Room"), () => {
            d.hide();
            this.open_room_change_dialog(stay, room);
        });

        d.set_primary_action(__("🚪 Checkout"), () => {
            if (r_info.folio_balance > 0) {
                frappe.msgprint({
                    title: __("Outstanding Balance"),
                    indicator: "orange",
                    message: __("This guest has an unpaid balance of {0}. Please settle the folio first.", [format_currency(r_info.folio_balance)]),
                    primary_action: {
                        label: __("Open Folio"),
                        action: () => {
                            d.hide();
                            frappe.set_route("Form", "Guest Folio", r_info.folio_name);
                        }
                    }
                });
            } else {
                frappe.confirm(__("Process Checkout for Room {0}?", [room]), () => {
                    d.hide();
                    this.process_checkout(stay);
                });
            }
        });

        d.show();
    }

    // Modal: Room Change
    open_room_change_dialog(stay, current_room) {
        let d = new frappe.ui.Dialog({
            title: __("🔄 Move Guest from Room {0}", [current_room]),
            fields: [
                {
                    label: __("Target Clean Room"),
                    fieldname: "new_room",
                    fieldtype: "Link",
                    options: "Hotel Room",
                    reqd: 1,
                    get_query: () => {
                        return {
                            filters: {
                                status: "Vacant Clean",
                                is_active: 1
                            }
                        };
                    }
                },
                {
                    label: __("Reason for Transfer"),
                    fieldname: "reason",
                    fieldtype: "Small Text",
                    default: "Guest Request",
                    reqd: 1
                }
            ],
            primary_action_label: __("Move Room"),
            primary_action: (vals) => {
                frappe.call({
                    method: "hotel_pms.hotel_pms.doctype.hotel_stay.hotel_stay.move_room",
                    args: {
                        stay: stay,
                        new_room: vals.new_room,
                        reason: vals.reason
                    },
                    freeze: true,
                    callback: (r) => {
                        d.hide();
                        frappe.show_alert({
                            message: __("Guest transferred to Room {0}!", [vals.new_room]),
                            indicator: "green"
                        });
                        this.load_data();
                    }
                });
            }
        });
        d.show();
    }

    // Check-in Arrival directly
    checkin_arrival(res_name, assigned_room) {
        if (!assigned_room) {
            // Ask for room assignment
            let d = new frappe.ui.Dialog({
                title: __("Assign Room for Check-In"),
                fields: [
                    {
                        label: __("Select Clean Room"),
                        fieldname: "room",
                        fieldtype: "Link",
                        options: "Hotel Room",
                        reqd: 1,
                        get_query: () => {
                            return {
                                filters: {
                                    status: "Vacant Clean",
                                    is_active: 1
                                }
                            };
                        }
                    }
                ],
                primary_action_label: __("Check-In"),
                primary_action: (vals) => {
                    d.hide();
                    this.execute_arrival_checkin(res_name, vals.room);
                }
            });
            d.show();
        } else {
            frappe.confirm(__("Check-in reservation {0} into Room {1}?", [res_name, assigned_room]), () => {
                this.execute_arrival_checkin(res_name, assigned_room);
            });
        }
    }

    execute_arrival_checkin(res_name, room) {
        frappe.call({
            method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.checkin_reservation",
            args: {
                reservation: res_name,
                room: room
            },
            freeze: true,
            freeze_message: __("Checking in reservation..."),
            callback: (r) => {
                if (r.message) {
                    frappe.show_alert({ message: __("Checked in successfully! Room {0} is now Occupied.", [room]), indicator: "green" });
                    this.load_data();
                }
            }
        });
    }

    // Process checkout helper
    process_checkout(stay_name) {
        frappe.call({
            method: "hotel_pms.hotel_pms.doctype.hotel_stay.hotel_stay.process_checkout",
            args: { stay: stay_name },
            freeze: true,
            freeze_message: __("Processing checkout & generating invoice..."),
            callback: (r) => {
                frappe.show_alert({ message: __("Checkout completed! Room marked for Housekeeping."), indicator: "green" });
                this.load_data();
            }
        });
    }

    // Mark Clean helper
    mark_clean(room) {
        frappe.call({
            method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.mark_room_clean",
            args: { room: room },
            callback: (r) => {
                frappe.show_alert({ message: __("Room {0} marked Clean!", [room]), indicator: "green" });
                this.load_data();
            }
        });
    }
}
