const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const Papa = require('papaparse');

// 1. Inicializamos el cliente. LocalAuth guarda la sesión en la carpeta .wwebjs_auth
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// 2. Generamos el código QR en la terminal para que lo vincules
client.on('qr', (qr) => {
    console.log('Escanea este código QR con tu aplicación de WhatsApp Business:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('¡Bot conectado exitosamente! Esperando mensajes...');
});

// 3. Escuchamos los mensajes entrantes
client.on('message', async message => {
    // Convertimos todo a minúsculas para que sea insensible a mayúsculas/minúsculas
    const msgText = message.body.toLowerCase();

    // Verificamos si el mensaje contiene la palabra "verificar"
    if (msgText.includes('verificar')) {
        
        // EXPRESIONES REGULARES (Flexibilidad total de orden y espacios)
        // Busca una 'r' (con o sin espacio) seguida de números
        const refMatch = msgText.match(/r\s*(\d+)/); 
        // Busca números (admite punto o coma decimal) seguidos de 'bs' (con o sin espacio)
        const amountMatch = msgText.match(/(\d+(?:[.,]\d+)?)\s*bs/);

        // Si el mensaje tiene tanto una referencia como un monto
        if (refMatch && amountMatch) {
            const referencia = refMatch[1]; // Extraemos solo los números de la referencia
            const montoBuscado = amountMatch[1].replace(',', '.'); // Estandarizamos a punto decimal
            const montoOriginalMatch = amountMatch[0]; // Ej: "500.87bs" tal cual lo escribió

            // URL del Google Sheet exportado a CSV
            const sheetId = '14bLRZ31MdiAT4N-v5ZbymSsHr4cd06ePaA22gmZSTlU';
            const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

            try {
                // Descargamos los datos de la hoja de cálculo
                const response = await axios.get(csvUrl);

                // Parseamos el documento (Asume que la fila 1 tiene encabezados como "Fecha", "Referencia", "Monto")
                const parsedData = Papa.parse(response.data, {
                    header: true,
                    skipEmptyLines: true
                });

                let pagoEncontrado = null;

                // Buscamos fila por fila
                for (const fila of parsedData.data) {
                    // Convertimos todos los valores de la fila a texto en minúsculas para facilitar la búsqueda
                    const filaValores = Object.values(fila).map(val => String(val).toLowerCase());

                    // Verificamos si algún valor de la fila coincide con la referencia
                    const tieneRef = filaValores.some(val => val.includes(referencia));

                    // Verificamos si algún valor de la fila coincide con el monto
                    const tieneMonto = filaValores.some(val => {
                        const valClean = val.replace(',', '.').trim();
                        // Chequeamos si el monto es exacto o si la celda lo incluye
                        return valClean === montoBuscado || valClean.includes(montoBuscado);
                    });

                    // Si encontramos una fila que tiene AMBOS valores
                    if (tieneRef && tieneMonto) {
                        pagoEncontrado = fila;
                        break; // Detenemos la búsqueda
                    }
                }

                if (pagoEncontrado) {
                    // Intentamos ubicar automáticamente cuál es la columna de la fecha
                    const claves = Object.keys(pagoEncontrado);
                    const claveFecha = claves.find(k => k.toLowerCase().includes('fecha'));
                    const fechaDelPago = claveFecha ? pagoEncontrado[claveFecha] : '[Fecha no encontrada en hoja]';

                    // Respuesta de éxito exacta a la que pediste
                    await message.reply(`*Si, hay un pago movil registrado con la fecha ${fechaDelPago} con el monto ${montoOriginalMatch} y el numero de referencia R${referencia}*`);
                } else {
                    // Respuesta de fallo exacta a la que pediste
                    await message.reply('*No, no existe un pago movil registrado con la referencia y monto indicados*');
                }

            } catch (error) {
                console.error('Error leyendo Google Sheets:', error.message);
                await message.reply('Hubo un error de conexión con la base de datos al intentar verificar el pago.');
            }
        } 
        // Si dice verificar pero no puso bien la R o el Bs, el bot simplemente lo ignora (o puedes agregar un else aquí)
    }
});

// Iniciamos el bot
client.initialize();
