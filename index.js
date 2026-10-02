const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const Papa = require('papaparse');

// 1. Inicializamos el cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    }
});

// 2. Generamos el código QR para vincular
client.on('qr', (qr) => {
    console.log('Escanea este código QR con tu aplicación de WhatsApp Business:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('¡Bot conectado exitosamente! Esperando mensajes...');
});

// 3. Escuchamos los mensajes entrantes
client.on('message', async message => {
    const msgText = message.body.toLowerCase();

    // Verificamos si el mensaje contiene la palabra "verificar"
    if (msgText.includes('verificar')) {
        
        // Expresiones regulares flexibles
        // Captura la referencia (busca 'r' seguida de números o secuencias numéricas)
        const refMatch = msgText.match(/r\s*(\d+)/i) || msgText.match(/(?:ref|referencia)?\s*(\d{5,})/i);
        // Captura el monto (números con punto/coma decimal)
        const amountMatch = msgText.match(/(\d+(?:[.,]\d+)?)\s*(?:bs|ves)?/i);

        if (refMatch && amountMatch) {
            const refBuscada = refMatch[1];
            const montoBuscadoStr = amountMatch[1].replace(',', '.');
            const montoBuscadoNum = parseFloat(montoBuscadoStr);

            // Enlace CSV del Google Sheet
            const sheetId = '14bLRZ31MdiAT4N-v5ZbymSsHr4cd06ePaA22gmZSTlU';
            const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

            try {
                const response = await axios.get(csvUrl);

                // Parseamos los datos en formato CSV
                const parsed = Papa.parse(response.data, {
                    header: true,
                    skipEmptyLines: true
                });

                let pagoEncontrado = null;

                for (const fila of parsed.data) {
                    const keys = Object.keys(fila);
                    
                    // Identificamos dinámicamente las columnas de la hoja
                    const keyRef = keys.find(k => k.toLowerCase().includes('ref')) || keys[0];
                    const keyMonto = keys.find(k => k.toLowerCase().includes('monto')) || keys[1];
                    const keyFecha = keys.find(k => k.toLowerCase().includes('fecha')) || keys[2];
                    const keyBanco = keys.find(k => k.toLowerCase().includes('banco')) || keys[4];

                    const refEnHoja = String(fila[keyRef] || '').trim();
                    const montoEnHojaRaw = String(fila[keyMonto] || '').replace(',', '.').trim();
                    const montoEnHojaNum = parseFloat(montoEnHojaRaw);

                    // Verificar si coincide la referencia
                    const coincideRef = refEnHoja.includes(refBuscada) || refBuscada.includes(refEnHoja);
                    
                    // Verificar si coincide el monto
                    const coincideMonto = !isNaN(montoBuscadoNum) && !isNaN(montoEnHojaNum) 
                        ? Math.abs(montoBuscadoNum - montoEnHojaNum) < 0.01 
                        : montoEnHojaRaw.includes(montoBuscadoStr);

                    if (coincideRef && coincideMonto) {
                        pagoEncontrado = {
                            fecha: fila[keyFecha] || 'Fecha no registrada',
                            monto: fila[keyMonto] || montoBuscadoStr,
                            referencia: refEnHoja,
                            banco: (keyBanco && fila[keyBanco] && fila[keyBanco].trim() !== '') ? fila[keyBanco] : 'Mercantil'
                        };
                        break;
                    }
                }

                // Respuestas según coincidencia
                if (pagoEncontrado) {
                    await message.reply(`*Si, hay un pago movil registrado con la fecha ${pagoEncontrado.fecha} con el monto ${pagoEncontrado.monto}, el numero de referencia ${pagoEncontrado.referencia} al banco ${pagoEncontrado.banco}*`);
                } else {
                    await message.reply('*No, no existe un pago movil registrado con la referencia y monto indicados*');
                }

            } catch (error) {
                console.error('Error al consultar Google Sheets:', error.message);
                await message.reply('Hubo un error de conexión con la base de datos al intentar verificar el pago.');
            }
        }
    }
});

client.initialize();

// Iniciamos el bot
client.initialize();
