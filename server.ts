import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { EventEmitter } from 'events';

const app = express();
const PORT = 3000;

// Log Tailer implementation
const LOG_FILE_PATH = path.join(process.cwd(), 'app.log');

class LogTailer extends EventEmitter {
  private filePath: string;
  private currentPos: number = 0;
  private isTailing: boolean = false;
  private watchTimer: NodeJS.Timeout | null = null;
  private bufferSize: number = 64 * 1024; // 64KB chunks to prevent RAM bloat
  private leftover: string = '';
  private fd: number | null = null;
  
  constructor(filePath: string) {
    super();
    this.filePath = filePath;
    // ensure file exists
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '');
    }
  }

  async start() {
    if (this.isTailing) return;
    this.isTailing = true;
    
    // Start at the end of the file or beginning? 
    // Start at the end to act just like a normal tail -f
    try {
      const stats = await fs.promises.stat(this.filePath);
      this.currentPos = stats.size;
    } catch {
      this.currentPos = 0;
    }

    try {
      const handle = await fs.promises.open(this.filePath, 'r');
      this.fd = handle.fd;
    } catch (e) {
      console.error("Could not open file", e);
      return;
    }

    // Polling approach (very lightweight if nothing to read)
    this.watchTimer = setInterval(() => this.readNewContent(), 250);
  }

  private async readNewContent() {
    if (this.fd === null) return;
    
    try {
      const stats = await fs.promises.stat(this.filePath);
      if (stats.size < this.currentPos) {
        // File was truncated or rolled over
        this.currentPos = 0;
      }
      
      if (stats.size > this.currentPos) {
        // We have new data
        const bytesToRead = stats.size - this.currentPos;
        // Apply backpressure / buffer management: Read in chunks, not all at once
        const readSize = Math.min(bytesToRead, this.bufferSize);
        const buffer = Buffer.alloc(readSize);
        
        // Asynchronous I/O
        const { bytesRead } = await new Promise<{bytesRead: number, buffer: Buffer}>((resolve, reject) => {
          fs.read(this.fd!, buffer, 0, readSize, this.currentPos, (err, bytesRead, buffer) => {
             if (err) reject(err);
             else resolve({ bytesRead, buffer });
          });
        });

        if (bytesRead > 0) {
          this.currentPos += bytesRead;
          const content = this.leftover + buffer.toString('utf8', 0, bytesRead);
          const lines = content.split('\n');
          this.leftover = lines.pop() || ''; // Last element might be incomplete line
          
          if (lines.length > 0) {
            this.emit('lines', lines);
          }
        }
      }
    } catch (err) {
      console.error("Error reading file:", err);
    }
  }

  stop() {
    this.isTailing = false;
    if (this.watchTimer) clearInterval(this.watchTimer);
    if (this.fd !== null) {
       fs.close(this.fd, () => {});
       this.fd = null;
    }
  }
}

const tailer = new LogTailer(LOG_FILE_PATH);
tailer.start();

// Simulated log generator
let generatorTimer: NodeJS.Timeout | null = null;
let linesWritten = 0;

function startGenerator() {
  if (generatorTimer) return;
  const levels = ['INFO', 'DEBUG', 'WARN', 'ERROR', 'FATAL'];
  const sources = ['NetworkTask', 'Authentication', 'DbConnection', 'UserService', 'SystemWorker', 'BillingJob'];
  const messages = [
    'Successfully connected to upstream service',
    'Connection timed out after 3000ms',
    'Failed to parse JSON payload',
    'User authenticated successfully',
    'Buffer overflow in primary queue',
    'Cache miss, querying database',
    'System shutting down partially',
    'Rate limit exceeded for endpoint'
  ];
  
  generatorTimer = setInterval(() => {
    const level = levels[Math.floor(Math.random() * levels.length)];
    const source = sources[Math.floor(Math.random() * sources.length)];
    const msg = messages[Math.floor(Math.random() * messages.length)];
    const time = Math.floor(Math.random() * 1500) + 'ms';
    
    // Add some random trace ID
    const traceId = Math.random().toString(36).substring(2, 10);
    
    const logLine = `[${new Date().toISOString()}] [${level.padEnd(5)}] [${source.padEnd(16)}] [trace-${traceId}] ${msg} | ${time}\n`;
    
    fs.appendFile(LOG_FILE_PATH, logLine, () => {});
    linesWritten++;
  }, 150); // Emit a log every 150ms
}

function stopGenerator() {
  if (generatorTimer) {
    clearInterval(generatorTimer);
    generatorTimer = null;
  }
}

startGenerator(); // Start by default

app.get('/api/generator/status', (req, res) => {
  res.json({ active: !!generatorTimer, linesWritten });
});

app.post('/api/generator/toggle', (req, res) => {
  if (generatorTimer) {
    stopGenerator();
  } else {
    startGenerator();
  }
  res.json({ active: !!generatorTimer });
});

app.post('/api/generator/clear', (req, res) => {
  stopGenerator();
  try {
     fs.writeFileSync(LOG_FILE_PATH, '');
     linesWritten = 0;
     tailer.stop();
     tailer.start(); // Restart tailer from beginning (0 pos)
  } catch(e) {}
  res.json({ cleared: true });
});

// SSE Endpoint
app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const onLines = (lines: string[]) => {
    res.write(`data: ${JSON.stringify({ type: 'logs', lines })}\n\n`);
  };

  tailer.on('lines', onLines);

  req.on('close', () => {
    tailer.off('lines', onLines);
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
