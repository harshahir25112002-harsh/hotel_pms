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
        // Date Selector in page header
        this.page.set_secondary_action(__("Today"), () => {
            this.selected_date = frappe.datetime.get_today();
            this.load_data();
        });

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

        // Quick New Reservation
        this.page.add_button(__("+ New Reservation"), () => {
            frappe.new_doc("Hotel Reservation", {
                arrival_date: this.selected_date
            });
        }, "octicon octicon-plus");

        // Run Night Audit
        this.page.add_button(__("Run Night Audit"), () => {
            frappe.confirm(__("Run Night Audit for {0}?", [this.selected_date]), () => {
                frappe.call({
                    method: "hotel_pms.hotel_pms.doctype.night_audit.night_audit.execute_daily_night_audit",
                    callback: (r) => {
                        frappe.msgprint(__("Night Audit completed!"));
                        this.load_data();
                    }
                });
            });
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
                        <button class="filter-pill" data-filter="Occupied">${__("Occupied")}</button>
                        <button class="filter-pill" data-filter="Vacant Clean">${__("Vacant Clean")}</button>
                        <button class="filter-pill" data-filter="Vacant Dirty">${__("Vacant Dirty")}</button>
                        <button class="filter-pill" data-filter="Out of Order">${__("Out of Order")}</button>
                    </div>
                </div>

                <!-- Room Rack Grid -->
                <div class="room-grid" id="room-matrix"></div>

                <!-- Operations Bottom Section (Tabs) -->
                <div class="dash-tabs-container">
                    <div class="dash-tabs">
                        <div class="dash-tab active" data-tab="arrivals">
                            ${__("Today's Arrivals")} <span class="tab-badge" id="badge-arrivals">0</span>
                        </div>
                        <div class="dash-tab" data-tab="departures">
                            ${__("Today's Departures")} <span class="tab-badge" id="badge-departures">0</span>
                        </div>
                        <div class="dash-tab" data-tab="housekeeping">
                            ${__("Housekeeping Queue")} <span class="tab-badge" id="badge-hk">0</span>
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

        // 1-Click Clean Room
        this.$wrapper.on("click", ".btn-mark-clean", (e) => {
            e.stopPropagation();
            let room = $(e.currentTarget).data("room");
            frappe.call({
                method: "hotel_pms.hotel_pms.page.hotel_dashboard.hotel_dashboard.mark_room_clean",
                args: { room: room },
                callback: (r) => {
                    frappe.show_alert({ message: __("Room {0} marked Clean", [room]), indicator: "green" });
                    this.load_data();
                }
            });
        });

        // Room card click
        this.$wrapper.on("click", ".room-card", (e) => {
            let stay = $(e.currentTarget).data("stay");
            let room = $(e.currentTarget).data("room");
            let status = $(e.currentTarget).data("status");

            if (stay) {
                frappe.set_route("Form", "Hotel Stay", stay);
            } else if (status === "Vacant Clean") {
                frappe.new_doc("Hotel Stay", {
                    room: room,
                    checkin_date: this.selected_date
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
                <div class="kpi-title">${__("Occupancy %")}</div>
                <div class="kpi-value">${k.occupancy_pct}%</div>
                <div class="kpi-sub">${k.occupied} / ${k.total_rooms} ${__("Rooms Booked")}</div>
            </div>
            <div class="kpi-card kpi-clean">
                <div class="kpi-title">${__("Vacant Clean")}</div>
                <div class="kpi-value">${k.vacant_clean}</div>
                <div class="kpi-sub">${__("Ready for check-in")}</div>
            </div>
            <div class="kpi-card kpi-dirty">
                <div class="kpi-title">${__("Vacant Dirty")}</div>
                <div class="kpi-value">${k.vacant_dirty}</div>
                <div class="kpi-sub">${__("Requires Housekeeping")}</div>
            </div>
            <div class="kpi-card kpi-occupied">
                <div class="kpi-title">${__("Occupied")}</div>
                <div class="kpi-value">${k.occupied}</div>
                <div class="kpi-sub">${__("Guests in-house")}</div>
            </div>
            <div class="kpi-card kpi-revenue">
                <div class="kpi-title">${__("Today's Revenue")}</div>
                <div class="kpi-value">${format_currency(k.today_revenue, currency)}</div>
                <div class="kpi-sub">ADR: ${format_currency(k.adr, currency)} | RevPAR: ${format_currency(k.revpar, currency)}</div>
            </div>
            <div class="kpi-card kpi-dues">
                <div class="kpi-title">${__("Pending Dues")}</div>
                <div class="kpi-value">${format_currency(k.total_unpaid, currency)}</div>
                <div class="kpi-sub">${__("Unsettled Folios")}</div>
            </div>
        `;
        this.$wrapper.find("#kpi-cards").html(html);

        // Update badges
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
                        <div class="room-type">${r.room_type} (Floor ${r.floor})</div>
                        ${r.guest_name ? `
                            <div class="room-guest">👤 ${frappe.utils.escape_html(r.guest_name)}</div>
                            <div class="room-dates">Check-out: ${r.expected_checkout || 'N/A'}</div>
                            ${r.folio_balance > 0 ? `<div class="room-folio-bal">Due: ${format_currency(r.folio_balance, currency)}</div>` : ''}
                        ` : ''}
                    </div>

                    <div class="room-actions">
                        ${r.status === 'Vacant Dirty' ? `
                            <button class="room-btn-sm btn-clean btn-mark-clean" data-room="${r.room}">✓ ${__("Mark Clean")}</button>
                        ` : ''}
                        ${r.status === 'Vacant Clean' ? `
                            <button class="room-btn-sm btn-checkin">${__("Check-In")}</button>
                        ` : ''}
                        ${r.status === 'Occupied' && r.folio_name ? `
                            <button class="room-btn-sm btn-folio" onclick="frappe.set_route('Form', 'Guest Folio', '${r.folio_name}')">${__("Folio")}</button>
                        ` : ''}
                    </div>
                </div>
            `;
        });

        if (rooms.length === 0) {
            html = `<div class="text-muted p-4">${__("No rooms match this filter.")}</div>`;
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
                        <th>${__("Tariff / Est. Total")}</th>
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
                    <td><span class="badge badge-info">${a.assigned_room || __('Unassigned')}</span></td>
                    <td>${a.nights}</td>
                    <td>${format_currency(a.estimated_total)}</td>
                    <td><span class="badge ${a.advance_paid > 0 ? 'badge-success' : 'badge-warning'}">${format_currency(a.advance_paid)}</span></td>
                    <td>
                        <button class="btn btn-xs btn-primary" onclick="frappe.set_route('Form', 'Hotel Reservation', '${a.name}')">
                            ${__("Open / Check-in")}
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        this.$wrapper.find("#pane-arrivals").html(html);
    }

    render_departures() {
        let departures = this.data.departures || [];
        if (departures.length === 0) {
            this.$wrapper.find("#pane-departures").html(`<div class="text-muted p-3">${__("No expected checkouts for this date.")}</div>`);
            return;
        }

        let html = `
            <table class="dash-table">
                <thead>
                    <tr>
                        <th>${__("Guest Name")}</th>
                        <th>${__("Room")}</th>
                        <th>${__("Check-in Date")}</th>
                        <th>${__("Folio Dues")}</th>
                        <th>${__("Action")}</th>
                    </tr>
                </thead>
                <tbody>
        `;

        departures.forEach(d => {
            html += `
                <tr>
                    <td><strong>${frappe.utils.escape_html(d.guest_name)}</strong></td>
                    <td><span class="badge badge-primary">${d.room}</span></td>
                    <td>${d.checkin_date}</td>
                    <td><strong class="${d.balance > 0 ? 'text-danger' : 'text-success'}">${format_currency(d.balance)}</strong></td>
                    <td>
                        <button class="btn btn-xs btn-danger" onclick="frappe.set_route('Form', 'Hotel Stay', '${d.name}')">
                            ${__("Checkout")}
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        this.$wrapper.find("#pane-departures").html(html);
    }

    render_housekeeping() {
        let tasks = this.data.housekeeping || [];
        if (tasks.length === 0) {
            this.$wrapper.find("#pane-housekeeping").html(`<div class="text-muted p-3">${__("All rooms are cleaned! No pending housekeeping tasks.")}</div>`);
            return;
        }

        let html = `
            <table class="dash-table">
                <thead>
                    <tr>
                        <th>${__("Room")}</th>
                        <th>${__("Task Type")}</th>
                        <th>${__("Priority")}</th>
                        <th>${__("Status")}</th>
                        <th>${__("Assigned Staff")}</th>
                        <th>${__("Action")}</th>
                    </tr>
                </thead>
                <tbody>
        `;

        tasks.forEach(t => {
            html += `
                <tr>
                    <td><strong>${t.room}</strong></td>
                    <td>${t.task_type}</td>
                    <td><span class="badge ${t.priority === 'High' || t.priority === 'Urgent' ? 'badge-danger' : 'badge-warning'}">${t.priority}</span></td>
                    <td><span class="badge badge-secondary">${t.status}</span></td>
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
}

