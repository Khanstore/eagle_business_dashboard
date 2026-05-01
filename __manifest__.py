{
    "name": "Advanced Business Dashboard",
    "version": "18.0.0.2",
    "author": "SM Ashraf",
    "depends": ["sale", "purchase", "account", "web"],
    "data": ["views/menu.xml"],
    "assets": {
        "web.assets_backend": [
            "eagle_business_dashboard/static/src/js/dashboard.js",
            "eagle_business_dashboard/static/src/xml/dashboard.xml",
            "eagle_business_dashboard/static/src/css/dashboard.css",
            "eagle_business_dashboard/static/src/js/finance_dashboard.js",
            "eagle_business_dashboard/static/src/xml/finance_dashboard.xml",
        ]
    },
    "installable": True,
    "licence": "LGPL-3",
    "application": True
}
