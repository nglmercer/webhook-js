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
    this.users = new Map();
    this.nextId = 0;
    this.wss = new WebSocket.Server({ server });
    this.setupWebSocketServer();
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws) => {
      const id = ++this.nextId;
      this.users.set(id, { id, ws });
      
      logger.info(`Nueva conexión WebSocket: ${id}`);
      
      ws.on('message', (message) => {
        try {
          // Intentamos parsear el mensaje como JSON
          const data = JSON.parse(message);
          this.broadcast(data);
        } catch (error) {
          // Si no es JSON, lo enviamos como texto
          this.broadcast(message.toString());
        }
      });
      
      ws.on('close', () => {
        logger.info(`Conexión WebSocket cerrada: ${id}`);
        this.users.delete(id);
      });
      
      ws.on('error', (error) => {
        logger.error(`Error en conexión WebSocket ${id}: ${error.message}`);
        this.users.delete(id);
      });
    });
  }

  broadcast(message) {
    logger.info('Iniciando broadcast');
    const jsonMessage = typeof message === 'string' ? message : JSON.stringify(message);
    
    logger.info(`Enviando mensaje a ${this.users.size} usuarios`);
    
    this.users.forEach((user) => {
      if (user.ws.readyState === WebSocket.OPEN) {
        logger.info(`Enviando mensaje a usuario ${user.id}`);
        user.ws.send(jsonMessage, (err) => {
          if (err) {
            logger.warn(`Error al enviar mensaje a usuario ${user.id}: ${err.message}`);
          } else {
            logger.info(`Mensaje enviado a usuario ${user.id}`);
          }
        });
      } else {
        logger.warn(`Usuario ${user.id} no está conectado`);
      }
    });
    
    logger.info('Broadcast completado');
  }

  sendTo(userId, message) {
    logger.info(`Enviando mensaje a usuario ${userId}`);
    
    const jsonMessage = typeof message === 'string' ? message : JSON.stringify(message);
    const user = this.users.get(userId);
    
    if (user && user.ws.readyState === WebSocket.OPEN) {
      logger.info(`Enviando mensaje a usuario ${userId}`);
      user.ws.send(jsonMessage, (err) => {
        if (err) {
          logger.warn(`Error al enviar mensaje a usuario ${userId}: ${err.message}`);
          return false;
        } else {
          logger.info(`Mensaje enviado a usuario ${userId}`);
          return true;
        }
      });
    } else {
      logger.warn(`Usuario ${userId} no encontrado o no está conectado`);
      return false;
    }
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

      wsServer.broadcast(messageWithHeaders);
      return res.status(200).send('Mensaje transmitido');
    } catch (error) {
      logger.error(`Error al transmitir mensaje: ${error.message}`);
      return res.status(500).send(`Error al transmitir mensaje: ${error.message}`);
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