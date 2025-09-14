module.exports = {
    apps: [{
            name: "backup",
            script: "backup.js",
            interpreter: "node",
            cron_restart: "10 0 * * *", // todos os dias às 00:10
            autorestart: false,
        },

        {
            name: "backup-banco",
            script: "banco.js",
            interpreter: "node",
            cron_restart: "20 0 * * *", // todos os dias às 00:10
            autorestart: false,
        },

    ],

};