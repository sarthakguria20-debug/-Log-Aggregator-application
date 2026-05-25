/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';

interface Stats {
  eventsPerSec: number;
  totalEvents: number;
  bufferSize: string;
}

export default function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [stats, setStats] = useState<Stats>({ eventsPerSec: 0, totalEvents: 0, bufferSize: '64 KB' });
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Keep track of events in the last second
  const eventsInLastSec = useRef<number>(0);

  useEffect(() => {
    fetch('/api/generator/status')
      .then(res => res.json())
      .then(data => setIsActive(data.active));
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/logs/stream');
    
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'logs' && data.lines) {
        setLogs(prev => {
          const newLogs = [...prev, ...data.lines].filter((line: string) => line.trim() !== '');
          // Keep max 500 lines to preserve frontend memory
          return newLogs.slice(-500);
        });
        
        setStats(prev => ({
          ...prev,
          totalEvents: prev.totalEvents + data.lines.length
        }));
        eventsInLastSec.current += data.lines.length;
      }
    };

    const interval = setInterval(() => {
      setStats(prev => ({
        ...prev,
        eventsPerSec: eventsInLastSec.current
      }));
      eventsInLastSec.current = 0;
    }, 1000);

    return () => {
      es.close();
      clearInterval(interval);
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const toggleGenerator = async () => {
    const res = await fetch('/api/generator/toggle', { method: 'POST' });
    const data = await res.json();
    setIsActive(data.active);
  };

  const clearLogs = async () => {
    await fetch('/api/generator/clear', { method: 'POST' });
    setLogs([]);
    setStats(prev => ({ ...prev, totalEvents: 0 }));
  };
  
  // Format the log line for some basic styling if needed
  const formatLog = (line: string) => {
    const match = line.match(/^\[(.*?)\] \[([A-Z\s]+)\] (.*)/);
    if (match) {
      const [, timestamp, levelName, rest] = match;
      const level = levelName.trim();
      let levelColor = "text-gray-400";
      if (level === "INFO") levelColor = "text-emerald-500";
      if (level === "DEBUG") levelColor = "text-blue-500";
      if (level === "WARN") levelColor = "text-yellow-500";
      if (level === "ERROR" || level === "FATAL") levelColor = "text-red-500";
      
      const timeOnly = timestamp.includes('T') ? timestamp.split('T')[1].replace('Z', '') : timestamp;
      
      return (
        <>
          <span className="text-gray-600">[{timeOnly}]</span> <span className={`${levelColor} font-bold`}>{level}</span> <span className="text-gray-300">{rest}</span>
        </>
      );
    }
    return <span className="text-gray-400">{line}</span>;
  };

  return (
    <div className="w-full min-h-screen bg-[#0A0B0D] text-gray-400 font-sans p-4 sm:p-6 flex flex-col h-screen overflow-hidden">
      {/* Header Section */}
      <header className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse"></div>
          <h1 className="text-xl font-bold tracking-tight text-white">LOG_AGENT <span className="text-gray-500 font-mono text-sm">v2.4.1-LTS</span></h1>
        </div>
        <div className="flex gap-6 text-xs font-mono">
          <div className="flex flex-col items-end">
            <span className="text-gray-600 uppercase">Endpoint</span>
            <span className="text-blue-400">central-dash.prod:9092</span>
          </div>
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-gray-600 uppercase">Async Mode</span>
            <span className="text-emerald-400">NON_BLOCKING_IO</span>
          </div>
        </div>
      </header>

      {/* Bento Grid Main Layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 auto-rows-[minmax(0,1fr)] max-md:flex max-md:flex-col md:grid-rows-6 gap-4 flex-grow min-h-0">
        
        {/* Live Tail: Largest Card */}
        <div className="md:col-span-8 md:row-span-6 bg-[#111216] border border-gray-800 rounded-xl flex flex-col min-h-[40vh] max-h-full">
          <div className="p-3 border-b border-gray-800 flex justify-between items-center shrink-0">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Live Stream / stdout</span>
            <span className="px-2 py-0.5 bg-gray-800 text-[10px] rounded text-gray-400 font-mono">TAILING: /var/log/app.log</span>
          </div>
          <div 
            ref={containerRef}
            className="p-4 font-mono text-xs overflow-y-auto leading-relaxed space-y-1 bg-black/30 flex-1 scrollbar-hide"
          >
            {logs.length === 0 ? (
              <div className="text-gray-600 italic">Waiting for log events...</div>
            ) : (
              logs.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  {formatLog(line)}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Throughput Graphic */}
        <div className="md:col-span-4 md:row-span-2 bg-[#111216] border border-gray-800 rounded-xl p-5 flex flex-col justify-between shrink-0">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Resource: Throughput</span>
            <span className="text-emerald-400 text-xl font-mono">{stats.eventsPerSec} <span className="text-xs text-gray-600">ev/s</span></span>
          </div>
          <div className="mt-4 flex gap-1 h-12 items-end">
            {Array.from({length: 8}).map((_, i) => {
               // Pseudo-random bar height based on events to make it look active
               const height = isActive ? Math.max(10, Math.min(100, Math.random() * 80 + 20)) : 10;
               return (
                 <div key={i} className={`flex-1 transition-all duration-300 ${isActive ? 'bg-emerald-500/40' : 'bg-emerald-500/10'}`} style={{ height: `${height}%` }}></div>
               );
            })}
          </div>
          <p className="text-[10px] text-gray-600 mt-2 italic">Strategy: Zero-copy polling via Sendfile()</p>
        </div>

        {/* Total Events / RAM substitute */}
        <div className="md:col-span-4 md:row-span-2 bg-[#111216] border border-gray-800 rounded-xl p-5 flex flex-col justify-between shrink-0">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Total Events Processed</span>
            <span className="text-blue-400 text-xl font-mono">{stats.totalEvents.toLocaleString()}</span>
          </div>
          <div className="bg-gray-800 h-2 rounded-full mt-4 overflow-hidden">
            <div className={`bg-blue-500 h-full transition-all duration-500 ${isActive ? 'w-full animate-pulse' : 'w-0'}`} style={{ width: isActive ? `${Math.min(100, (stats.totalEvents % 1000) / 10)}%` : '0%' }}></div>
          </div>
          <div className="flex justify-between text-[10px] text-gray-600 mt-4">
            <span>Buffer: {stats.bufferSize}</span>
            <span>Dropped: 0</span>
            <span>Backpressure: {isActive ? 'IDLE' : 'SLEEP'}</span>
          </div>
        </div>

        {/* Controls / Active Threads */}
        <div className="md:col-span-4 md:row-span-2 bg-[#111216] border border-gray-800 rounded-xl p-5 shrink-0 flex flex-col">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-500 block mb-4">Service Controls</span>
          <div className="space-y-4 flex-1 justify-center flex flex-col">
            <div className="flex items-center justify-between text-xs">
               <span className="font-medium text-gray-400">Generator Thread</span>
               <button 
                 onClick={toggleGenerator}
                 className={`px-3 py-1 rounded-[4px] font-bold uppercase tracking-wider transition-colors ${
                   isActive 
                     ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 shadow-[0_0_8px_rgba(239,68,68,0.1)]' 
                     : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.1)]'
                 }`}
               >
                 {isActive ? 'Stop' : 'Start'}
               </button>
            </div>
            
            <div className="flex items-center justify-between text-xs">
               <span className="font-medium text-gray-400">Memory Flush</span>
               <button 
                 onClick={clearLogs}
                 className="px-3 py-1 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white rounded-[4px] font-bold uppercase tracking-wider transition-colors"
               >
                 Clear Memory
               </button>
            </div>
          </div>
        </div>

      </div>

      {/* Footer Bar */}
      <footer className="mt-6 flex justify-between items-center text-[10px] uppercase tracking-[0.2em] font-medium text-gray-600 border-t border-gray-800 pt-4 shrink-0 hidden sm:flex">
        <div className="flex gap-8">
          <span>Session ID: {Math.random().toString(36).substring(2, 6).toUpperCase()}-992-0X</span>
          <span>Status: {isActive ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <div className="flex gap-4">
          <span>Syscall: Epoll_Wait()</span>
          <span>Protocol: SSE_KEEPALIVE</span>
        </div>
      </footer>
    </div>
  );
}