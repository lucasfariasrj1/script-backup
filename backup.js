require("dotenv").config();
const fs = require("fs-extra");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const archiver = require("archiver");
const { execSync } = require("child_process");
const fetch = require("node-fetch");

// 🔹 VALIDAÇÃO DE VARIÁVEIS
[
  "R2_ACCESS_KEY",
  "R2_SECRET_KEY",
  "R2_BUCKET",
  "R2_ACCOUNT_ID",
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASS",
  "WHATSAPP_APPKEY",
  "WHATSAPP_AUTHKEY",
  "WHATSAPP_TO"
].forEach(key => {
  if (!process.env[key]) {
    console.error(`❌ Variável de ambiente ausente: ${key}`);
    process.exit(1);
  }
});

// 🔹 CLIENTE S3 CLOUDFLARE R2
const client = new S3Client({
  region: "auto",
  endpoint: process.env.ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/lfdev001`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
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
const timestamp = `${day}-${month}-${year}_${hour}-${minute}-${second}`;
const timeStr = `${hour}:${minute}:${second}`;

let report = `📦 Backup automático - ${dateStr}\n🕒 Horário: ${timeStr}\n\n`;

// 🔹 FUNÇÃO ZIP DE PASTA
async function zipDirectory(source, out) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const stream = fs.createWriteStream(out);

  return new Promise((resolve, reject) => {
    archive.glob("**/*", { cwd: source, ignore: ["**/node_modules/**"], dot: true })
      .on("error", reject)
      .pipe(stream);

    stream.on("close", resolve);
    archive.finalize().catch(reject);
  });
}

// 🔹 FUNÇÃO ZIP DE ARQUIVO
async function zipFile(sourceFile, outputZip) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const stream = fs.createWriteStream(outputZip);

  return new Promise((resolve, reject) => {
    archive.file(sourceFile, { name: path.basename(sourceFile) });
    archive.on("error", reject).pipe(stream);
    stream.on("close", resolve);
    archive.finalize().catch(reject);
  });
}

// 🔹 ENVIA PARA R2
async function uploadToR2(localPath, remoteName) {
  const stream = fs.createReadStream(localPath);
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: remoteName,
    Body: stream,
    ContentType: "application/zip",
    ContentDisposition: `attachment; filename="${path.basename(remoteName)}"`,
  });

  await client.send(command);
  console.log(`✅ Enviado para R2: ${remoteName}`);
}

// 🔹 BACKUP DE DIRETÓRIOS
async function backupDirectories(basePath, label) {
  const folders = fs.readdirSync(basePath).filter(f => fs.statSync(path.join(basePath, f)).isDirectory());

  for (const folder of folders) {
    const folderPath = path.join(basePath, folder);
    const zipName = `${folder}-${timestamp}.zip`;
    const remotePath = `${label}/${year}/${month}/${day}/${zipName}`;
    const localZipPath = `/tmp/${zipName}`;

    console.log(`📁 Compactando diretório: ${folderPath}`);
    await zipDirectory(folderPath, localZipPath);
    await uploadToR2(localZipPath, remotePath);
    fs.removeSync(localZipPath);

    report += `📂 Diretório: ${label}/${folder}\n`;
  }
}

// 🔹 BACKUP DE MYSQL
async function backupMySQLDatabases() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASS } = process.env;

  const databasesRaw = execSync(
    `mysql -h${DB_HOST} -P${DB_PORT} -u${DB_USER} -p${DB_PASS} -e "SHOW DATABASES;"`
  )
    .toString()
    .split("\n")
    .slice(1)
    .filter(db => db && !["information_schema", "performance_schema", "mysql", "sys"].includes(db.trim()));

  for (const db of databasesRaw) {
    const dbName = db.trim();
    const sqlFile = `/tmp/${dbName}-${dateStr}.sql`;
    const zipOutput = `/tmp/${dbName}-${dateStr}.zip`;
    const remotePath = `banco/${year}/${month}/${day}/${dbName}-${timestamp}.zip`;

    try {
      console.log(`💾 Dump do banco: ${dbName}`);
      execSync(`mysqldump -h${DB_HOST} -P${DB_PORT} -u${DB_USER} -p${DB_PASS} ${dbName} > ${sqlFile}`);

      await zipFile(sqlFile, zipOutput);
      await uploadToR2(zipOutput, remotePath);

      report += `🗄️ Banco: ${dbName}\n`;
    } catch (err) {
      console.error(`❌ Erro no backup do banco ${dbName}:`, err.message);
      report += `⚠️ Erro no banco ${dbName}: ${err.message}\n`;
    } finally {
      fs.removeSync(sqlFile, { force: true });
      fs.removeSync(zipOutput, { force: true });
    }
  }
}

// 🔹 FUNÇÃO PARA ENVIAR MENSAGEM WHATSAPP
async function sendWhatsAppMessage(text) {
  const data = {
    appkey: process.env.WHATSAPP_APPKEY,
    authkey: process.env.WHATSAPP_AUTHKEY,
    to: process.env.WHATSAPP_TO,
    message: text
  };

  try {
    const res = await fetch("https://chatbot.menuia.com/api/create-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    const json = await res.json();
    if (json.status === 200) {
      console.log("📨 Mensagem enviada via WhatsApp com sucesso");
    } else {
      console.error("❌ Falha ao enviar WhatsApp:", json);
    }
  } catch (err) {
    console.error("❌ Erro ao enviar WhatsApp:", err.message);
  }
}

// 🔹 EXECUÇÃO PRINCIPAL
(async () => {
  try {
    console.log("🔄 Iniciando backup...");

    await backupDirectories("/var/www/html", "html");
    await backupDirectories("/root/Api", "api");

    await backupMySQLDatabases();

    report += `\n✅ Status: Backup finalizado com sucesso`;
    await sendWhatsAppMessage(report);

  } catch (err) {
    console.error("❌ Erro geral no backup:", err);
    await sendWhatsAppMessage(`❌ Erro no backup em ${dateStr}\n${err.message}`);
  }
})();
