{
    "name": "Advanced Business Dashboard",
    "version": "18.0.2.6",
    "author": "SM Ashraf",
    "depends": ["sale", "purchase", "account", "web", "stock"],
    "data": [
        "security/groups.xml",
        "security/ir.model.access.csv",
        "data/cron.xml",
        "views/menu.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "eagle_business_dashboard/static/src/js/shared_filter_state.js",
            "eagle_business_dashboard/static/src/js/dashboard.js",
            "eagle_business_dashboard/static/src/xml/dashboard.xml",
            "eagle_business_dashboard/static/src/css/dashboard.css",
            "eagle_business_dashboard/static/src/js/finance_dashboard.js",
            "eagle_business_dashboard/static/src/xml/finance_dashboard.xml",
            "eagle_business_dashboard/static/src/js/operations_dashboard.js",
            "eagle_business_dashboard/static/src/xml/operations_dashboard.xml",
        ]
    },
    "installable": True,
    "licence": "LGPL-3",
    "application": True
}
