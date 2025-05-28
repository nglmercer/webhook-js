const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');

// Configuración del logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'server.log' })
  ]
});

// Inicialización de la aplicación Express
const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  exposedHeaders: ['Access-Control-Allow-Origin'],
  credentials: true,
  maxAge: 3600
}));
app.use(bodyParser.json({ limit: '16mb' }));
app.use(express.static('public'));

// Crear servidor HTTP
const server = http.createServer(app);

// Clase para gestionar el servidor WebSocket
class WebSocketServer {
  constructor() {
    this.users = new Map(); // Map<string, { ws: WebSocket }>
    this.wss = new WebSocket.Server({ server });
    this.setupWebSocketServer();
  }

  // Client-Side Implementation Note:
  // Clients connecting to this WebSocket server MUST send a registration message
  // immediately after the connection is established. The message should be a JSON string
  // with the following format:
  // {
  //   "type": "register",
  //   "userId": "your_kick_user_id" // Replace with the actual Kick User ID
  // }
  // The server will wait for this message for a short period (e.g., 10 seconds)
  // and will close the connection if it's not received or is invalid.
  // The 'userId' provided here is used to route specific Kick events (received via webhook)
  // to this client.
  setupWebSocketServer() {
    this.wss.on('connection', (ws) => {
      logger.info('Nueva conexión WebSocket iniciada, esperando registro...');

      const registrationTimeout = setTimeout(() => {
        logger.error('Timeout de registro. Cerrando conexión.');
        ws.close();
      }, 10000); // 10 segundos para registrarse

      ws.once('message', (message) => {
        clearTimeout(registrationTimeout); // Cancelar el timeout al recibir mensaje
        try {
          const parsedMessage = JSON.parse(message);
          if (parsedMessage.type === 'register' && parsedMessage.userId) {
            const userId = parsedMessage.userId.toString(); // Asegurarse que userId es string
            
            if (this.users.has(userId)) {
              logger.warn(`Usuario ${userId} ya está conectado. Rechazando nueva conexión.`);
              ws.close();
              return;
            }
            
            ws.userId = userId; // Guardar userId en el objeto WebSocket
            this.users.set(userId, { ws });
            logger.info(`Usuario ${userId} registrado y conectado.`);

            // Configurar listeners para mensajes posteriores, cierre y error DESPUÉS del registro
            ws.on('message', (subsequentMessage) => {
              try {
                const data = JSON.parse(subsequentMessage);
                this.broadcast(data); // O manejar mensajes específicos del cliente
              } catch (error) {
                this.broadcast(subsequentMessage.toString());
              }
            });

            ws.on('close', () => {
              logger.info(`Conexión WebSocket cerrada para usuario: ${ws.userId}`);
              if (ws.userId) {
                this.users.delete(ws.userId);
              }
            });
      
            ws.on('error', (error) => {
              logger.error(`Error en conexión WebSocket para usuario ${ws.userId}: ${error.message}`);
              if (ws.userId) {
                this.users.delete(ws.userId);
              }
            });

          } else {
            logger.error('Mensaje de registro inválido. Cerrando conexión.');
            ws.close();
          }
        } catch (error) {
          logger.error(`Error al parsear mensaje de registro: ${error.message}. Cerrando conexión.`);
          ws.close();
        }
      });

      // Manejadores de 'close' y 'error' iniciales por si la conexión se cierra/da error ANTES del registro
      // Estos se sobreescribirán si el registro es exitoso.
      ws.once('close', () => {
        clearTimeout(registrationTimeout); // Asegurarse de limpiar el timeout
        logger.info('Conexión WebSocket cerrada antes del registro.');
      });
      
      ws.once('error', (error) => {
        clearTimeout(registrationTimeout); // Asegurarse de limpiar el timeout
        logger.error(`Error en WebSocket antes del registro: ${error.message}`);
      });
    });
  }

  broadcast(message) {
    logger.info('Iniciando broadcast');
    const jsonMessage = typeof message === 'string' ? message : JSON.stringify(message);
    
    logger.info(`Enviando mensaje a ${this.users.size} usuarios`);
    
    this.users.forEach((user, userId) => { // user es { ws }
      if (user.ws.readyState === WebSocket.OPEN) {
        logger.info(`Enviando mensaje a usuario ${userId}`);
        user.ws.send(jsonMessage, (err) => {
          if (err) {
            logger.warn(`Error al enviar mensaje a usuario ${userId}: ${err.message}`);
          } else {
            logger.info(`Mensaje enviado a usuario ${userId}`);
          }
        });
      } else {
        logger.warn(`Usuario ${userId} no está conectado`);
      }
    });
    
    logger.info('Broadcast completado');
  }

  sendTo(userId, message) {
    logger.info(`Enviando mensaje a usuario ${userId}`);
    
    const jsonMessage = typeof message === 'string' ? message : JSON.stringify(message);
    const client = this.users.get(userId); // client es { ws }
    
    if (client && client.ws.readyState === WebSocket.OPEN) {
      logger.info(`Enviando mensaje a usuario ${userId}`);
      client.ws.send(jsonMessage, (err) => {
        if (err) {
          logger.warn(`Error al enviar mensaje a usuario ${userId}: ${err.message}`);
          return false; // Esta devolución no tiene efecto en un callback asíncrono
        } else {
          logger.info(`Mensaje enviado a usuario ${userId}`);
          return true; // Esta devolución no tiene efecto en un callback asíncrono
        }
      });
    } else {
      logger.warn(`Usuario ${userId} no encontrado o no está conectado`);
      // No se puede devolver true/false de forma fiable aquí debido a la naturaleza asíncrona de send.
      // Si se necesita confirmación, se debe implementar un mecanismo de ack.
      return false; // Indica que el usuario no fue encontrado o no está conectado.
    }
    // Implícitamente devuelve undefined si el mensaje se intentó enviar.
    // Para un mejor manejo de errores/confirmaciones, se necesitaría un sistema de ACK.
  }
}

// Instanciar el servidor WebSocket
const wsServer = new WebSocketServer();

// Ruta para el webhook
app.post('/webhook', (req, res) => {
  // Obtener los headers específicos de Kick
  const eventType = req.headers['kick-event-type'];
  const eventVersion = req.headers['kick-event-version'];

  logger.info(`Recibido webhook: Tipo=${eventType}, Version=${eventVersion}`);
  logger.info(`Payload: ${JSON.stringify(req.body)}`);
  
  // Verificar que los headers requeridos estén presentes
  if (!eventType || !eventVersion) {
    logger.error('Headers requeridos faltantes');
    return res.status(400).send('Headers requeridos faltantes: kick-event-type y kick-event-version son obligatorios');
  }

  // Verificar que el cuerpo sea un objeto JSON válido
  if (req.body && typeof req.body === 'object') {
    try {
      // Agregar los headers al objeto que se enviará
      const messageWithHeaders = {
        eventType,
        eventVersion,
        data: req.body
      };

      // Extract targetUserId
      let targetUserId = null;
      if (req.body.data) {
        if (req.body.data.channel_id) {
          targetUserId = req.body.data.channel_id.toString();
        } else if (req.body.data.channel && req.body.data.channel.id) {
          targetUserId = req.body.data.channel.id.toString();
        } else if (req.body.data.broadcaster_id) {
          targetUserId = req.body.data.broadcaster_id.toString();
        } else if (req.body.data.broadcaster && req.body.data.broadcaster.id) {
          targetUserId = req.body.data.broadcaster.id.toString();
        }
      }

      if (!targetUserId) {
        logger.warn('Event received but could not be routed; no target user ID found in payload.');
        return res.status(200).send('Event received but could not be routed; no target user ID found.');
      }

      logger.info(`Extracted targetUserId: ${targetUserId} from webhook payload.`);

      const sent = wsServer.sendTo(targetUserId, messageWithHeaders);
      
      if (sent) {
        // sendTo returns true if user was found and message dispatch was attempted.
        // The actual confirmation of message delivery is async and logged within sendTo.
        logger.info(`Webhook event for ${targetUserId} processed and dispatch attempted.`);
        return res.status(200).send('Event processed and sent to target user.');
      } else {
        // sendTo returns false if the user was not found or not connected.
        logger.warn(`Webhook event for ${targetUserId} processed but target user not found or not connected.`);
        return res.status(200).send('Event processed but target user not found or not connected.');
      }
    } catch (error) {
      logger.error(`Error processing webhook: ${error.message}`);
      return res.status(500).send(`Error processing webhook: ${error.message}`);
    }
  } else {
    logger.error('Formato de payload webhook inválido');
    return res.status(400).send('Formato de payload webhook inválido: se esperaba un objeto JSON');
  }
});

// Iniciar el servidor
server.listen(port, '0.0.0.0', () => {
  logger.info(`Servidor ejecutándose en ws://0.0.0.0:${port}`);
});