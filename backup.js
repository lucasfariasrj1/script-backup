require("dotenv").config();
const fs = require("fs-extra");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const archiver = require("archiver");
const fetch = require("node-fetch");

// 🔹 Cliente S3 (Cloudflare R2)
const client = new S3Client({
    region: "auto",
    endpoint: process.env.ENDPOINT, // ex: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
    },
});

// 🔹 Datas
const today = new Date();
const day = String(today.getDate()).padStart(2, "0");
const month = String(today.getMonth() + 1).padStart(2, "0");
const year = today.getFullYear();
const hour = String(today.getHours()).padStart(2, "0");
const minute = String(today.getMinutes()).padStart(2, "0");
const second = String(today.getSeconds()).padStart(2, "0");

const dateStr = `${day}-${month}-${year}`;
const monthStr = `${month}`;
const timeStr = `${hour}:${minute}:${second}`;
const timestamp = `${day}-${month}-${year}_${hour}-${minute}-${second}`;

let telegramReport = `📦 *Backup automático - ${dateStr}*\n🕒 Horário: ${timeStr}\n\n`;

// 🔹 Compacta diretório
async function zipDirectory(source, out) {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const stream = fs.createWriteStream(out);

    return new Promise((resolve, reject) => {
        archive
            .glob("**/*", {
                cwd: source,
                ignore: ["**/node_modules/**"],
                dot: true,
            })
            .on("error", err => reject(err))
            .pipe(stream);

        stream.on("close", () => resolve());
        archive.finalize();
    });
}

// 🔹 Upload para R2
async function uploadToR2(localPath, remoteName) {
    const stream = fs.createReadStream(localPath);
    const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: remoteName,
        Body: stream,
        ContentType: "application/zip",
    });

    await client.send(command);
    console.log(`✅ Enviado para R2: ${remoteName}`);
}

// 🔹 Faz backup dos diretórios
async function backupDirectories(basePath, label) {
    const folders = fs.readdirSync(basePath).filter(f =>
        fs.statSync(path.join(basePath, f)).isDirectory()
    );

    for (const folder of folders) {
        const folderPath = path.join(basePath, folder);
        const zipName = `${folder}-${monthStr}-${timestamp}.zip`;
        const remotePath = `${label}/${monthStr}/${dateStr}/${zipName}`;
        const localZipPath = `/tmp/${zipName}`;

        console.log(`📁 Compactando: ${folderPath}`);
        await zipDirectory(folderPath, localZipPath);
        await uploadToR2(localZipPath, remotePath);
        fs.removeSync(localZipPath);

        telegramReport += `📂 *Diretório:* ${label}/${folder}\n`;
    }
}

// 🔹 Envia mensagem no Telegram
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

// 🔹 Execução principal
(async () => {
    try {
        console.log("🔄 Iniciando backup de diretórios...");
        await backupDirectories("/var/www/html", "html");
        await backupDirectories("/root/Api", "api");

        telegramReport += `\n✅ *Status:* Backup finalizado com sucesso`;
        await sendTelegramMessage(telegramReport);

    } catch (err) {
        console.error("❌ Erro no processo de backup:", err);
        await sendTelegramMessage(`❌ *Erro no backup em ${dateStr}*\n${err.message}`);
    }
})();
