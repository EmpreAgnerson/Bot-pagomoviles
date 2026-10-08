const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');
const Papa = require('papaparse');
const pino = require('pino');

const app = express();
const port = process.env.PORT || 3000;

let qrBase64 = ''; 
let isConnected = false;

app.get('/', (req, res) => {
    if (isConnected) {
        res.send('<h1 style="font-family:sans-serif; text-align:center; color:green; margin-top:20%;">¡El bot está conectado y funcionando!</h1>');
    } else if (qrBase64) {
        res.send(`
            <html>
                <body style="display:flex; justify-content:center; align-items:center; height:100vh; background-color:#f0f0f0; font-family:sans-serif;">
                    <div style="text-align:center; background:white; padding:30px; border-radius:10px; box-shadow:0 0 15px rgba(0,0,0,0.2);">
                        <h2>Escanea este QR con WhatsApp</h2>
                        <img src="${qrBase64}" alt="QR Code" style="width:300px; height:300px; margin: 15px 0;"/>
                    </div>
                </body>
            </html>
        `);
    } else {
        res.send('<h1 style="font-family:sans-serif; text-align:center; margin-top:20%;">Generando QR... Recarga la página en 5 segundos.</h1>');
    }
});

app.listen(port, () => {
    console.log(`Servidor web corriendo en el puerto ${port}`);
});

function parseMonto(montoStr) {
    if (!montoStr) return NaN;
    let limpio = String(montoStr).trim().replace(/[^\d.,]/g, '');
    if (!limpio) return NaN;

    let lastDot = limpio.lastIndexOf('.');
    let lastComma = limpio.lastIndexOf(',');

    if (lastDot !== -1 && lastComma !== -1) {
        if (lastComma > lastDot) {
            limpio = limpio.replace(/\./g, '').replace(',', '.');
        } else {
            limpio = limpio.replace(/,/g, '');
        }
    } else if (lastComma !== -1) {
        if (limpio.length - lastComma <= 3) {
            limpio = limpio.replace(',', '.'); 
        } else {
            limpio = limpio.replace(',', ''); 
        }
    } else if (lastDot !== -1) {
        if (limpio.length - lastDot > 3) {
            limpio = limpio.replace(/\./g, ''); 
        }
    }
    return parseFloat(limpio);
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrBase64 = await qrcode.toDataURL(qr);
        if (connection === 'close') {
            isConnected = false;
            if (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut) connectToWhatsApp();
        } else if (connection === 'open') {
            isConnected = true;
            qrBase64 = ''; 
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try { // <- ESTO EVITA QUE EL BOT MUERA EN SILENCIO
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const remoteJid = msg.key.remoteJid;
            const msgText = msg.message.conversation || 
                            msg.message.extendedTextMessage?.text || 
                            msg.message.imageMessage?.caption || 
                            "";
                            
            const msgLower = msgText.toLowerCase();

            if (msgLower.includes('verificar')) {
                const refMatch = msgLower.match(/r\s*(\d+)/i) || msgLower.match(/(?:ref|referencia)?\s*(\d{4,})/i);

                if (refMatch) {
                    const refBuscada = refMatch[1];
                    const msgSinRef = msgLower.replace(refMatch[0], '');
                    const amountMatch = msgSinRef.match(/([\d.,]+)\s*(?:bs|ves)/i);

                    if (amountMatch) {
                        const montoOriginalStr = amountMatch[1];
                        const montoBuscadoNum = parseMonto(montoOriginalStr); 

                        // Añadimos &gid=0 al final de la URL para forzar siempre la primera hoja
                        const sheetId = '14bLRZ31MdiAT4N-v5ZbymSsHr4cd06ePaA22gmZSTlU';
                        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;

                        try {
                            const response = await axios.get(csvUrl);
                            
                            // Blindaje al leer CSV (evita errores con comas en los números)
                            const parsed = Papa.parse(response.data, { 
                                header: true, 
                                skipEmptyLines: true,
                                transformHeader: h => h.trim().toLowerCase() // Asegura que las columnas se llamen igual
                            });

                            let pagoEncontrado = null;

                            for (const fila of parsed.data) {
                                // Buscar las columnas usando el nombre estandarizado (minúsculas)
                                const refEnHoja = String(fila['referencia'] || '').trim().replace(/'/g, ''); // Quitamos el apóstrofe si existe
                                const montoEnHojaNum = parseMonto(fila['monto']); 

                                const coincideRef = refEnHoja.endsWith(refBuscada) || refEnHoja === refBuscada;
                                const coincideMonto = !isNaN(montoBuscadoNum) && !isNaN(montoEnHojaNum) 
                                    ? Math.abs(montoBuscadoNum - montoEnHojaNum) < 0.01 
                                    : false;

                                if (coincideRef && coincideMonto) {
                                    pagoEncontrado = {
                                        fecha: fila['fecha'] || 'Fecha no registrada',
                                        monto: fila['monto'] || montoOriginalStr,
                                        referencia: refEnHoja, 
                                        banco: (fila['banco receptor'] && fila['banco receptor'].trim() !== '') ? fila['banco receptor'] : 'Desconocido'
                                    };
                                    break; // Ya lo encontró, deja de buscar
                                }
                            }

                            if (pagoEncontrado) {
                                await sock.sendMessage(remoteJid, { text: `*Si, hay un pago movil registrado con la fecha ${pagoEncontrado.fecha} con el monto ${pagoEncontrado.monto} Bs, el numero de referencia ${pagoEncontrado.referencia} al banco ${pagoEncontrado.banco}*` }, { quoted: msg });
                            } else {
                                await sock.sendMessage(remoteJid, { text: '*No, no existe un pago movil registrado con la referencia y monto indicados*' }, { quoted: msg });
                            }

                        } catch (apiError) {
                            console.error('Error conectando a Sheets:', apiError.message);
                            await sock.sendMessage(remoteJid, { text: 'Hubo un error temporal conectando a la base de datos. Por favor, intenta de nuevo.' }, { quoted: msg });
                        }
                    }
                }
            }
        } catch (fatalError) {
            // Si cualquier otra cosa explota, el bot no se muere
            console.error('Error crítico procesando mensaje:', fatalError);
        }
    });
}

connectToWhatsApp();
