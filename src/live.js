// Server-Sent Events hub: pushes new posts, quiz launches and chat messages to open browsers.
const clients = new Map(); // attendeeId -> Set<res>

function addClient(attendeeId, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 4000\n\n');
  if (!clients.has(attendeeId)) clients.set(attendeeId, new Set());
  clients.get(attendeeId).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => {
    clearInterval(ping);
    const set = clients.get(attendeeId);
    if (set) {
      set.delete(res);
      if (!set.size) clients.delete(attendeeId);
    }
  });
}

function write(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendTo(attendeeId, event, data) {
  const set = clients.get(attendeeId);
  if (set) for (const res of set) write(res, event, data);
}

function sendAll(event, data) {
  for (const set of clients.values()) for (const res of set) write(res, event, data);
}

const onlineIds = () => [...clients.keys()];

module.exports = { addClient, sendTo, sendAll, onlineIds };
