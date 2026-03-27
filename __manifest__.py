{
    "name": "Advanced Business Dashboard",
    "version": "18.0.0.1",
    "author": "SM Ashraf",
    "depends": ["sale", "purchase", "account", "web"],
    "data": ["views/menu.xml"],
    "assets": {
        "web.assets_backend": [
            "eagle_business_dashboard/static/src/js/dashboard.js",
            "eagle_business_dashboard/static/src/xml/dashboard.xml",
            "eagle_business_dashboard/static/src/css/dashboard.css"
        ]
    },
    "installable": True,
    "application": True
}