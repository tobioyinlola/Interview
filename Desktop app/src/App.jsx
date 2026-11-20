import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

// Helper to safely invoke Tauri commands without crashing in a web browser
async function callTauri(cmd, args = {}) {
    try {
        if (typeof window !== 'undefined' && window.__TAURI_IPC__) {
            return await invoke(cmd, args);
        }
    } catch (err) {
        console.warn(`[Tauri] invoke ${cmd} warning:`, err);
    }
}

// Regex matching webapp's answerOf logic to strip system prompts (TYPE:, SOURCES:)
const MARKER = /^[ \t]*(?:SAMPLE[ \t]+)?ANSWER[ \t]*:[ \t]*/im;
const NEXT = /^[ \t]*(?:SOURCES|POINTS|CLOSE)[ \t]*:/im;
const PARTIAL_HEADING = /\n[ \t]*(?:S|SO|SOU|SOUR|SOURC|SOURCE|SOURCES|P|PO|POI|POIN|POINT|POINTS|C|CL|CLO|CLOS|CLOSE)[ \t]*$/i;

function cleanAnswer(text, streaming = false) {
    if (!text) return '';
    const start = MARKER.exec(text);
    if (!start) {
        const rest = text.replace(/^\s*TYPE[ \t]*:[^\n]*\n?/i, '').trim();
        return streaming && rest.length < 50 ? '' : rest;
    }
    let body = text.slice(start.index + start[0].length);
    const next = NEXT.exec(body);
    if (next) body = body.slice(0, next.index);
    else if (streaming) body = body.replace(PARTIAL_HEADING, '');
    return body.trim();
}

export default function App() {
    const [pin, setPin] = useState(() => localStorage.getItem('audiocore_pin') || '');
    const [serverUrl, setServerUrl] = useState(() => localStorage.getItem('audiocore_server_url') || 'http://localhost:8000');
    const [showSettings, setShowSettings] = useState(false);
    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [clickThrough, setClickThrough] = useState(false);
    const [statusText, setStatusText] = useState('Idle');
    const [question, setQuestion] = useState('');
    const [answerRaw, setAnswerRaw] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);

    const wsRef = useRef(null);

    // Save settings
    useEffect(() => {
        try {
            localStorage.setItem('audiocore_pin', pin);
            localStorage.setItem('audiocore_server_url', serverUrl);
        } catch {
            /* storage disabled */
        }
    }, [pin, serverUrl]);

    // Keyboard shortcuts (Ctrl+Shift+X or Alt+C toggles click-through)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey && e.shiftKey && e.key === 'X') || (e.altKey && e.key.toLowerCase() === 'c')) {
                e.preventDefault();
                toggleClickThrough();
            } else if (e.key === 'Escape' && connected) {
                // If unlocked and pressing escape, close or clear
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [connected, clickThrough]);

    const toggleClickThrough = async () => {
        const next = !clickThrough;
        setClickThrough(next);
        await callTauri('set_click_through', { ignore: next });
    };

    const enableClickThrough = async () => {
        setClickThrough(true);
        await callTauri('set_click_through', { ignore: true });
    };

    const disableClickThrough = async () => {
        setClickThrough(false);
        await callTauri('set_click_through', { ignore: false });
    };

    const connectToSession = (e) => {
        if (e) e.preventDefault();
        setErrorMsg(null);

        const cleanPin = pin.replace(/[^0-9]/g, '').trim();
        if (cleanPin.length !== 6) {
            setErrorMsg('Please enter a valid 6-digit PIN from the Web App.');
            return;
        }

        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        setConnecting(true);
        setStatusText('Connecting…');

        const baseUrl = serverUrl.trim().replace(/\/+$/, '');
        const wsProtocol = baseUrl.startsWith('https') ? 'wss:' : 'ws:';
        const hostPath = baseUrl.replace(/^https?:\/\//i, '');
        const endpoint = `${wsProtocol}//${hostPath}/api/sessions/stream?pin=${cleanPin}`;

        try {
            const ws = new WebSocket(endpoint);
            wsRef.current = ws;

            ws.onopen = async () => {
                setConnecting(false);
                setConnected(true);
                setStatusText('Synced with Interview');
                // Automatically activate click-through overlay so it floats stealthily
                await enableClickThrough();
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'connected') {
                        setStatusText('Connected to Live Session');
                    } else if (data.type === 'question') {
                        setQuestion(data.question || '');
                        setAnswerRaw(data.text || '');
                        setIsStreaming(true);
                        setStatusText('Thinking…');
                    } else if (data.type === 'delta') {
                        setIsStreaming(true);
                        setStatusText('Streaming answer…');
                        if (data.question && !question) setQuestion(data.question);
                        setAnswerRaw((prev) => (data.accumulated ? data.accumulated : prev + (data.text || '')));
                    } else if (data.type === 'done') {
                        setIsStreaming(false);
                        setStatusText('Answer complete');
                        if (data.text) setAnswerRaw(data.text);
                        if (data.question) setQuestion(data.question);
                    } else if (data.type === 'skip') {
                        setIsStreaming(false);
                        setStatusText('Question skipped');
                    } else if (data.type === 'test') {
                        setQuestion(data.question || 'Test Question');
                        setAnswerRaw(data.text || '');
                        setIsStreaming(false);
                        setStatusText('Test message received');
                    } else if (data.type === 'end') {
                        setIsStreaming(false);
                        setStatusText('Session ended by Web App');
                    } else if (data.type === 'error') {
                        setIsStreaming(false);
                        setStatusText('Error');
                        setErrorMsg(data.message || 'Stream error occurred.');
                    }
                } catch (err) {
                    console.error('Failed to parse WebSocket message:', err);
                }
            };

            ws.onerror = (err) => {
                console.error('WebSocket connection error:', err);
                setConnecting(false);
                setErrorMsg('Could not connect to the Web App. Check the PIN and Server URL.');
            };

            ws.onclose = async () => {
                setConnected(false);
                setConnecting(false);
                setStatusText('Disconnected');
                await disableClickThrough();
            };
        } catch (err) {
            setConnecting(false);
            setErrorMsg(`Connection error: ${err.message}`);
        }
    };

    const disconnectSession = async () => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        setConnected(false);
        setConnecting(false);
        await disableClickThrough();
    };

    const clearScreen = () => {
        setQuestion('');
        setAnswerRaw('');
        setStatusText('Cleared');
    };

    const cleanDisplayAnswer = cleanAnswer(answerRaw, isStreaming);

    if (!connected) {
        return (
            <div style={{
                padding: '16px',
                background: 'rgba(15, 17, 23, 0.94)',
                backdropFilter: 'blur(12px)',
                height: '100vh',
                boxSizing: 'border-box',
                borderRadius: '10px',
                border: '1px solid #2a2e39',
                color: '#e1e4ea',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                display: 'flex',
                flexDirection: 'column'
            }}>
                {/* Drag Handle */}
                <div
                    data-tauri-drag-region
                    style={{
                        height: '32px',
                        backgroundColor: '#1e222d',
                        color: '#8b949e',
                        cursor: 'grab',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        userSelect: 'none',
                        marginBottom: '14px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 600,
                        letterSpacing: '1px',
                        border: '1px dashed #343a46'
                    }}
                >
                    ≡ DRAG TO POSITION HUD ≡
                </div>

                <div style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h1 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: '#f0f6fc' }}>
                            AudioCore Stealth Thin-Client
                        </h1>
                        <span style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            background: '#238636',
                            color: '#fff',
                            borderRadius: '12px',
                            fontWeight: 'bold'
                        }}>
                            STEALTH MODE
                        </span>
                    </div>
                    <p style={{ fontSize: '11px', color: '#8b949e', margin: '4px 0 0 0' }}>
                        Invisible to screen capture and video calls. Syncs live suggestions from your web interview.
                    </p>
                </div>

                {errorMsg && (
                    <div style={{
                        padding: '8px 10px',
                        background: 'rgba(248, 81, 73, 0.15)',
                        border: '1px solid #f85149',
                        borderRadius: '6px',
                        color: '#ff7b72',
                        fontSize: '12px',
                        marginBottom: '12px'
                    }}>
                        {errorMsg}
                    </div>
                )}

                <form onSubmit={connectToSession} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '11px', color: '#8b949e', marginBottom: '4px', fontWeight: 500 }}>
                            Web App Session PIN
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. 582-934"
                            value={pin}
                            maxLength={8}
                            onChange={(e) => setPin(e.target.value)}
                            style={{
                                padding: '10px 12px',
                                width: '100%',
                                boxSizing: 'border-box',
                                background: '#0d1117',
                                color: '#58a6ff',
                                border: '1px solid #30363d',
                                borderRadius: '6px',
                                fontSize: '16px',
                                fontFamily: 'monospace',
                                fontWeight: 'bold',
                                letterSpacing: '2px',
                                textAlign: 'center'
                            }}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={connecting}
                        style={{
                            padding: '10px',
                            background: connecting ? '#238636aa' : '#238636',
                            color: '#ffffff',
                            border: 'none',
                            cursor: connecting ? 'wait' : 'pointer',
                            borderRadius: '6px',
                            fontWeight: 600,
                            fontSize: '13px',
                            transition: 'background 0.2s',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                        }}
                    >
                        {connecting ? 'Connecting…' : 'Sync to Interview'}
                    </button>
                </form>

                {/* Settings Toggle */}
                <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid #21262d' }}>
                    <div
                        onClick={() => setShowSettings(!showSettings)}
                        style={{
                            fontSize: '11px',
                            color: '#58a6ff',
                            cursor: 'pointer',
                            userSelect: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                        }}
                    >
                        <span>⚙ Server Settings</span>
                        <span>{showSettings ? '▲' : '▼'}</span>
                    </div>

                    {showSettings && (
                        <div style={{ marginTop: '8px' }}>
                            <input
                                type="text"
                                placeholder="http://localhost:8000"
                                value={serverUrl}
                                onChange={(e) => setServerUrl(e.target.value)}
                                style={{
                                    padding: '6px 8px',
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    background: '#0d1117',
                                    color: '#c9d1d9',
                                    border: '1px solid #30363d',
                                    borderRadius: '4px',
                                    fontSize: '11px'
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // CONNECTED STEALTH HUD VIEW
    return (
        <div style={{
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            background: clickThrough ? 'transparent' : 'rgba(10, 12, 16, 0.85)',
            borderRadius: '8px',
            overflow: 'hidden',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>
            {/* Top HUD Controller Bar */}
            <div
                data-tauri-drag-region
                style={{
                    padding: '6px 12px',
                    background: clickThrough ? 'rgba(0,0,0,0.45)' : '#161b22',
                    backdropFilter: 'blur(8px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    userSelect: 'none'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: '#3fb950',
                        boxShadow: '0 0 6px #3fb950'
                    }} />
                    <span style={{ fontSize: '11px', color: '#c9d1d9', fontWeight: 600 }}>
                        {statusText}
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                        onClick={toggleClickThrough}
                        title="Toggle Click-Through (Alt+C)"
                        style={{
                            padding: '3px 8px',
                            fontSize: '10px',
                            fontWeight: 600,
                            background: clickThrough ? '#8957e5' : '#30363d',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        {clickThrough ? 'CLICK-THROUGH: ON' : 'CLICK-THROUGH: OFF'}
                    </button>
                    {!clickThrough && (
                        <>
                            <button
                                onClick={clearScreen}
                                title="Clear display"
                                style={{
                                    padding: '3px 6px',
                                    fontSize: '10px',
                                    background: '#21262d',
                                    color: '#8b949e',
                                    border: '1px solid #30363d',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                Clear
                            </button>
                            <button
                                onClick={disconnectSession}
                                title="Disconnect from session"
                                style={{
                                    padding: '3px 6px',
                                    fontSize: '10px',
                                    background: '#da3633',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                Disconnect
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Content Area */}
            <div style={{
                flex: 1,
                padding: '16px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
            }}>
                {/* Active Question Banner */}
                {question && (
                    <div style={{
                        padding: '8px 12px',
                        background: 'rgba(30, 35, 48, 0.75)',
                        backdropFilter: 'blur(6px)',
                        borderRadius: '6px',
                        borderLeft: '3px solid #58a6ff'
                    }}>
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#8b949e', fontWeight: 'bold' }}>
                            Partner Question
                        </div>
                        <div style={{
                            color: '#ffffff',
                            fontSize: '14px',
                            fontWeight: 500,
                            marginTop: '2px',
                            textShadow: '0 1px 2px rgba(0,0,0,0.8)'
                        }}>
                            {question}
                        </div>
                    </div>
                )}

                {/* AI Outline / Suggested Answer */}
                <div style={{
                    flex: 1,
                    background: 'rgba(13, 17, 23, 0.65)',
                    backdropFilter: 'blur(8px)',
                    borderRadius: '8px',
                    padding: '12px',
                    border: '1px solid rgba(255,255,255,0.06)'
                }}>
                    <div style={{
                        fontSize: '10px',
                        textTransform: 'uppercase',
                        color: '#3fb950',
                        fontWeight: 'bold',
                        marginBottom: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                    }}>
                        <span>Live Suggested Answer</span>
                        {isStreaming && (
                            <span style={{ color: '#d29922' }}>● Thinking / Writing…</span>
                        )}
                    </div>

                    <div style={{
                        color: '#e6edf3',
                        fontSize: '15px',
                        lineHeight: '1.6',
                        whiteSpace: 'pre-wrap',
                        textShadow: '0 1px 3px rgba(0,0,0,0.9)'
                    }}>
                        {cleanDisplayAnswer || (
                            <span style={{ color: '#8b949e', fontStyle: 'italic', fontSize: '13px' }}>
                                Waiting for your partner to ask a question…
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
