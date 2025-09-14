require("dotenv").config(); // carrega variáveis do .env
const fs = require("fs-extra");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const archiver = require("archiver");
const { execSync } = require("child_process");
const fetch = require("node-fetch");

// 🔹 CONFIGS DO BANCO (pega do .env)
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = process.env.DB_PORT || "3306";
const DB_USER = process.env.DB_USER || "root";
const DB_PASS = process.env.DB_PASS || "";

// 🔹 CONFIGS CLOUDFLARE R2
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;

// 🔹 CLIENTE S3 PARA R2
const client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY,
    },
});

// 🔹 DATA ATUAL
const today = new Date();
const day = String(today.getDate()).padStart(2, "0");
const month = String(today.getMonth() + 1).padStart(2, "0");
const year = today.getFullYear();
const hour = String(today.getHours()).padStart(2, "0");
const minute = String(today.getMinutes()).padStart(2, "0");
const second = String(today.getSeconds()).padStart(2, "0");
const dateStr = `${day}-${month}-${year}`;
const timeStr = `${hour}-${minute}-${second}`;

// 🔹 ZIPA O ARQUIVO
async function zipFile(sourceFile, outputZip) {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const stream = fs.createWriteStream(outputZip);

    return new Promise((resolve, reject) => {
        archive.file(sourceFile, { name: path.basename(sourceFile) });
        archive.on("error", err => reject(err)).pipe(stream);
        stream.on("close", () => resolve());
        archive.finalize();
    });
}

// 🔹 ENVIA PARA R2
async function uploadToR2(localPath, remoteName) {
    const stream = fs.createReadStream(localPath);
    const command = new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: remoteName,
        Body: stream,
        ContentType: "application/zip",
    });

    await client.send(command);
    console.log(`✅ Enviado para R2: ${remoteName}`);
}

// 🔹 BACKUP DO MYSQL
async function backupMySQLDatabases() {
    const databasesRaw = execSync(
        `mysql -h${DB_HOST} -P${DB_PORT} -u${DB_USER} -p${DB_PASS} -e "SHOW DATABASES;"`
    )
        .toString()
        .split("\n")
        .slice(1)
        .filter(db =>
            db && !["information_schema", "performance_schema", "mysql", "sys"].includes(db.trim())
        );

    for (const db of databasesRaw) {
        const dbName = db.trim();
        const sqlFile = `/tmp/${dbName}-${dateStr}.sql`;
        const zipOutput = `/tmp/${dbName}-${dateStr}.zip`;

        const folderName = `banco/${year}/${month}/${day}`;
        const remotePath = `${folderName}/${dbName}-${dateStr}.zip`;

        execSync(`mysqldump -h${DB_HOST} -P${DB_PORT} -u${DB_USER} -p${DB_PASS} ${dbName} > ${sqlFile}`);
        await zipFile(sqlFile, zipOutput);
        await uploadToR2(zipOutput, remotePath);

        fs.removeSync(sqlFile);
        fs.removeSync(zipOutput);
    }
}

// 🔹 NOTIFICA NO TELEGRAM
async function sendTelegramMessage(text) {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHATID;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: "Markdown",
            }),
        });

        if (!res.ok) {
            const error = await res.text();
            console.error("❌ Falha ao enviar alerta para o Telegram:", error);
        } else {
            console.log("📨 Alerta enviado para o Telegram");
        }
    } catch (err) {
        console.error("❌ Erro ao enviar alerta para o Telegram:", err.message);
    }
}

// 🔹 EXECUÇÃO
(async () => {
    try {
        console.log("💾 Iniciando backup dos bancos de dados...");
        await backupMySQLDatabases();

        console.log("✅ Backup concluído com sucesso.");
        await sendTelegramMessage(`✅ Backup concluído em ${dateStr} às ${hour}:${minute}:${second}`);
    } catch (err) {
        console.error("❌ Erro no processo de backup:", err);
        await sendTelegramMessage(`❌ Erro ao realizar backup em ${dateStr}`);
    }
})();
