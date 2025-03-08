# Webhook-JS

A real-time WebSocket server that receives webhook payloads and broadcasts them to connected clients. This lightweight service allows you to easily relay webhook events to multiple clients in real-time.

## Features

- Receives webhook payloads via HTTP POST requests
- Broadcasts messages to all connected WebSocket clients
- Supports direct messaging to specific clients
- Handles both JSON and text messages
- Comprehensive logging
- CORS enabled for cross-origin requests

## Installation

```bash
# Clone the repository
git clone <your-repository-url>
cd webhook-js

# Install dependencies
npm install
```

## Usage

### Starting the Server

```bash
# Start the server in production mode
npm start

# Start the server in development mode with auto-restart
npm run dev
```

By default, the server runs on port 8080. You can change this by setting the `PORT` environment variable.

### Sending Webhooks

Send a POST request to the `/webhook` endpoint with a JSON payload:

```bash
curl -X POST http://localhost:8080/webhook \
  -H "Content-Type: application/json" \
  -d '{"event":"update","data":{"id":123,"status":"completed"}}'
```

### Connecting Clients

Clients can connect to the WebSocket server using the WebSocket protocol:

```javascript
// Browser example
const socket = new WebSocket('ws://localhost:8080');

socket.onopen = () => {
  console.log('Connected to WebSocket server');
};

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received message:', data);
};

// Send a message to all clients
socket.send(JSON.stringify({type: 'message', content: 'Hello everyone!'}));
```

## API Reference

### HTTP Endpoints

- `POST /webhook`: Accepts webhook payloads and broadcasts them to all connected WebSocket clients

### WebSocket Server

The WebSocket server handles the following events:

- `connection`: New client connection
- `message`: Message from a client (broadcasts to all other clients)
- `close`: Client disconnection
- `error`: Connection error

## Logging

Logs are written to both the console and a `server.log` file using Winston.

## License

MIT