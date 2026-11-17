/**
 * Test Tier 7: Codex & Multi-IDE Protocol Stream Adversarial Suite
 * 
 * Verifies:
 * 1. Reverse-proxy buffering immunity: X-Accel-Buffering: no & Cache-Control: no-cache on all SSE streams.
 * 2. Extreme TCP packet fragmentation & multi-byte UTF-8 boundary safety (StringDecoder state machine).
 * 3. Concurrent tool_calls index isolation & chunk parameter assembly without cross-talk.
 * 4. Trailing line flush without newline on upstream disconnect (zero tail loss).
 * 5. Anthropic stream byte-fragmented chunk parsing with zero corruption.
 * 6. bridgeChatStream bidirectional mapping, reasoning streaming, and exactly-once [DONE] guarantee.
 * 7. DeepSeek <think> split-token stateful streaming without text leaks.
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const codexAdapter = require('./codex-adapter');
const server = require('./server');

function createMockClientRes() {
  const writtenChunks = [];
  let headersSent = false;
  let headers = {};
  let statusCode = 200;
  let writableEnded = false;
  let destroyed = false;

  const res = new EventEmitter();
  res.writeHead = (code, hdrs) => {
    statusCode = code;
    headers = { ...headers, ...hdrs };
    headersSent = true;
    res.headersSent = true;
  };
  res.setHeader = (k, v) => {
    headers[k.toLowerCase()] = v;
  };
  res.getHeader = (k) => headers[k.toLowerCase()];
  res.write = (chunk) => {
    if (writableEnded || destroyed) return false;
    writtenChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };
  res.end = (chunk) => {
    if (chunk) res.write(chunk);
    writableEnded = true;
    res.writableEnded = true;
    res.emit('finish');
    res.emit('close');
  };
  res.destroy = () => {
    destroyed = true;
    res.destroyed = true;
  };

  res.getWrittenOutput = () => writtenChunks.join('');
  res.getParsedSSEEvents = () => {
    const raw = writtenChunks.join('');
    const events = [];
    const blocks = raw.split('\n\n');
    for (const block of blocks) {
      if (!block.trim()) continue;
      const lines = block.split('\n');
      let ev = null;
      let data = null;
      for (const line of lines) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) data = line.slice(5).trim();
      }
      events.push({ event: ev, data });
    }
    return events;
  };
  res.getHeaders = () => headers;
  return res;
}

function chunkStringIntoByteFragments(str, maxFragmentSize = 3) {
  const buf = Buffer.from(str, 'utf8');
  const chunks = [];
  let offset = 0;
  while (offset < buf.length) {
    const size = Math.min(Math.floor(Math.random() * maxFragmentSize) + 1, buf.length - offset);
    chunks.push(buf.subarray(offset, offset + size));
    offset += size;
  }
  return chunks;
}

async function main() {
  console.log('================================================================');
  console.log('🛡️  Starting Tier 7 Codex & Multi-IDE Stream Adversarial Suite');
  console.log('================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  async function test(name, fn) {
    totalTests++;
    try {
      await fn();
      passedTests++;
      console.log(`[PASS] Test ${totalTests}: ${name}`);
    } catch (err) {
      console.error(`[FAIL] Test ${totalTests}: ${name}`);
      console.error(err);
      process.exit(1);
    }
  }

  // -------------------------------------------------------------
  // SECTION 1: Reverse-Proxy Buffering Immunity & Headers
  // -------------------------------------------------------------
  console.log('--- SECTION 1: Reverse-Proxy Buffering Immunity & Headers ---');

  await test('1.1 server.getCorsHeaders injects X-Accel-Buffering: no for SSE', async () => {
    const sseHeaders = server.getCorsHeaders({ 'content-type': 'text/event-stream; charset=utf-8' });
    assert.strictEqual(sseHeaders['x-accel-buffering'], 'no');
    assert.strictEqual(sseHeaders['cache-control'], 'no-cache');

    const jsonHeaders = server.getCorsHeaders({ 'content-type': 'application/json' });
    assert.strictEqual(jsonHeaders['x-accel-buffering'], undefined);
  });

  await test('1.2 codexAdapter stream bridges set X-Accel-Buffering: no', async () => {
    const mockRes1 = createMockClientRes();
    const upstream1 = new EventEmitter();
    codexAdapter.bridgeResponsesStream(upstream1, mockRes1, 'gpt-5.6-luna', 'req_hdr1');
    assert.strictEqual(mockRes1.getHeaders()['X-Accel-Buffering'], 'no');
    assert.strictEqual(mockRes1.getHeaders()['Cache-Control'], 'no-cache');
    upstream1.emit('end');

    const mockRes2 = createMockClientRes();
    const upstream2 = new EventEmitter();
    codexAdapter.bridgeAnthropicStream(upstream2, mockRes2, 'claude-3-5-sonnet', 'req_hdr2');
    assert.strictEqual(mockRes2.getHeaders()['X-Accel-Buffering'], 'no');
    assert.strictEqual(mockRes2.getHeaders()['Cache-Control'], 'no-cache');
    upstream2.emit('end');

    const mockRes3 = createMockClientRes();
    const upstream3 = new EventEmitter();
    codexAdapter.bridgeChatStream(upstream3, mockRes3, 'deepseek-v4.1-flash', 'req_hdr3');
    assert.strictEqual(mockRes3.getHeaders()['X-Accel-Buffering'], 'no');
    assert.strictEqual(mockRes3.getHeaders()['Cache-Control'], 'no-cache');
    upstream3.emit('end');
  });

  // -------------------------------------------------------------
  // SECTION 2: Extreme TCP Byte Fragmentation & Multi-Byte UTF-8
  // -------------------------------------------------------------
  console.log('--- SECTION 2: Extreme TCP Byte Fragmentation & Multi-Byte UTF-8 ---');

  await test('2.1 bridgeResponsesStream handles 1-byte TCP fragment stream of multi-byte Chinese and Emoji', async () => {
    const mockRes = createMockClientRes();
    const upstream = new EventEmitter();
    let streamFinished = false;

    codexAdapter.bridgeResponsesStream(upstream, mockRes, 'deepseek-v4.1-flash', 'req_utf8', () => {
      streamFinished = true;
    });

    const fullPayload = 
      'data: {"choices":[{"delta":{"content":"【测试】你好，世界！🚀 这是一个极端 1-byte 碎片切分的 SSE 流测试。100% 保持 UTF-8 字符完整无损！"}}]}\n\n' +
      'data: [DONE]\n\n';

    // Split entire SSE stream into 1-byte chunks
    const buf = Buffer.from(fullPayload, 'utf8');
    for (let i = 0; i < buf.length; i++) {
      upstream.emit('data', buf.subarray(i, i + 1));
    }
    upstream.emit('end');

    assert.strictEqual(streamFinished, true);
    const events = mockRes.getParsedSSEEvents();
    
    // Find output_text.delta events and reconstruct text
    let reconstructedText = '';
    for (const ev of events) {
      if (ev.event === 'response.output_text.delta') {
        const parsed = JSON.parse(ev.data);
        reconstructedText += parsed.delta;
      }
    }

    assert.strictEqual(reconstructedText.includes('【测试】你好，世界！🚀 这是一个极端 1-byte 碎片切分的 SSE 流测试。100% 保持 UTF-8 字符完整无损！'), true);
    assert.strictEqual(reconstructedText.includes('\uFFFD'), false, 'Must not contain UTF-8 replacement character \uFFFD');
  });

  await test('2.2 bridgeResponsesStream trailing line without newline is cleanly flushed on end', async () => {
    const mockRes = createMockClientRes();
    const upstream = new EventEmitter();
    let streamFinished = false;

    codexAdapter.bridgeResponsesStream(upstream, mockRes, 'deepseek-v4.1-flash', 'req_tail', () => {
      streamFinished = true;
    });

    // Send first line with newline
    upstream.emit('data', Buffer.from('data: {"choices":[{"delta":{"content":"第一行文字\\n"}}]}\n', 'utf8'));

    // Send second line WITHOUT newline at the end!
    upstream.emit('data', Buffer.from('data: {"choices":[{"delta":{"content":"最后一行没有换行符"}}]}', 'utf8'));

    // Upstream finishes immediately
    upstream.emit('end');

    assert.strictEqual(streamFinished, true);
    const events = mockRes.getParsedSSEEvents();
    let reconstructedText = '';
    for (const ev of events) {
      if (ev.event === 'response.output_text.delta') {
        const parsed = JSON.parse(ev.data);
        reconstructedText += parsed.delta;
      }
    }

    assert.strictEqual(reconstructedText.includes('最后一行没有换行符'), true, 'Trailing line without newline must be flushed before completion');
    const hasCompleted = events.some(e => e.event === 'response.completed');
    assert.strictEqual(hasCompleted, true);
  });

  // -------------------------------------------------------------
  // SECTION 3: Concurrent Tool Calls Chunk Demuxing & Assembly
  // -------------------------------------------------------------
  console.log('--- SECTION 3: Concurrent Tool Calls Chunk Demuxing & Assembly ---');

  await test('3.1 bridgeResponsesStream correctly demuxes interleaved concurrent tool_calls across fragmented chunks', async () => {
    const mockRes = createMockClientRes();
    const upstream = new EventEmitter();
    let streamFinished = false;

    codexAdapter.bridgeResponsesStream(upstream, mockRes, 'deepseek-v4.1-flash', 'req_tools', () => {
      streamFinished = true;
    });

    const sseLines = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_search_1","type":"function","function":{"name":"code_search","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_read_2","type":"function","function":{"name":"read_file","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\": \\"bridgeResponsesStream\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\\"path\\": \\"codex-adapter.js\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":", \\"limit\\": 10}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":", \\"encoding\\": \\"utf8\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n'
    ];

    // Stream lines in random 2~7 byte chunks
    for (const line of sseLines) {
      const fragments = chunkStringIntoByteFragments(line, 5);
      for (const f of fragments) {
        upstream.emit('data', f);
      }
    }
    upstream.emit('end');

    assert.strictEqual(streamFinished, true);
    const events = mockRes.getParsedSSEEvents();
    
    // Verify tool calls completion
    const tool0Done = events.find(e => e.event === 'response.output_item.done' && e.data?.includes('code_search'));
    const tool1Done = events.find(e => e.event === 'response.output_item.done' && e.data?.includes('read_file'));

    assert.ok(tool0Done, 'code_search output_item.done must exist');
    assert.ok(tool1Done, 'read_file output_item.done must exist');

    const parsed0 = JSON.parse(tool0Done.data);
    const parsed1 = JSON.parse(tool1Done.data);

    assert.strictEqual(parsed0.item.name, 'code_search');
    const args0 = JSON.parse(parsed0.item.arguments);
    assert.strictEqual(args0.query, 'bridgeResponsesStream');
    assert.strictEqual(args0.limit, 10);

    assert.strictEqual(parsed1.item.name, 'read_file');
    const args1 = JSON.parse(parsed1.item.arguments);
    assert.strictEqual(args1.path, 'codex-adapter.js');
    assert.strictEqual(args1.encoding, 'utf8');
  });

  // -------------------------------------------------------------
  // SECTION 4: bridgeAnthropicStream Fragmented Stream Safety
  // -------------------------------------------------------------
  console.log('--- SECTION 4: bridgeAnthropicStream Fragmented Stream Safety ---');

  await test('4.1 bridgeAnthropicStream handles multi-byte UTF-8 in 2-byte fragments', async () => {
    const mockRes = createMockClientRes();
    const upstream = new EventEmitter();
    let streamFinished = false;

    codexAdapter.bridgeAnthropicStream(upstream, mockRes, 'claude-3-5-sonnet', 'req_anth_utf8', () => {
      streamFinished = true;
    });

    const anthropicPayload = 
      'data: {"type":"message_start","message":{"id":"msg_123","model":"claude-3-5-sonnet"}}\n\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"深度思考：Claude 模型在分包情况下的中文输出测试。"}}\n\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":25}}\n\n' +
      'data: {"type":"message_stop"}\n\n';

    const fragments = chunkStringIntoByteFragments(anthropicPayload, 2);
    for (const f of fragments) {
      upstream.emit('data', f);
    }
    upstream.emit('end');

    assert.strictEqual(streamFinished, true);
    const events = mockRes.getParsedSSEEvents();
    let reconstructedText = '';
    for (const ev of events) {
      if (ev.event === 'response.output_text.delta') {
        const parsed = JSON.parse(ev.data);
        reconstructedText += parsed.delta;
      }
    }

    assert.strictEqual(reconstructedText.includes('深度思考：Claude 模型在分包情况下的中文输出测试。'), true);
    assert.strictEqual(reconstructedText.includes('\uFFFD'), false);
  });

  // -------------------------------------------------------------
  // SECTION 5: bridgeChatStream Bidirectional Protocol Mapping & [DONE]
  // -------------------------------------------------------------
  console.log('--- SECTION 5: bridgeChatStream Bidirectional Protocol & [DONE] ---');

  await test('5.1 bridgeChatStream emits exactly-once data: [DONE] and finish_reason: stop', async () => {
    const mockRes = createMockClientRes();
    const upstream = new EventEmitter();
    let streamFinished = false;

    codexAdapter.bridgeChatStream(upstream, mockRes, 'deepseek-v4.1-flash', 'req_chat_done', () => {
      streamFinished = true;
    });

    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"World!"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":12}}\n\n',
      'data: [DONE]\n\n'
    ];

    for (const line of sseLines) {
      upstream.emit('data', Buffer.from(line, 'utf8'));
    }
    // End upstream
    upstream.emit('end');

    assert.strictEqual(streamFinished, true);
    const output = mockRes.getWrittenOutput();
    
    // Count occurrences of [DONE]
    const doneMatches = output.match(/data: \[DONE\]/g);
    assert.strictEqual(doneMatches?.length, 1, 'Must send exactly one data: [DONE]');

    // Verify content
    assert.strictEqual(output.includes('Hello '), true);
    assert.strictEqual(output.includes('World!'), true);
  });

  await test('5.2 bridgeChatStream converts Responses API stream into ChatCompletions SSE with reasoning_content', async () => {
    const mockRes = createMockClientRes();
    const upstream = new EventEmitter();
    let streamFinished = false;

    codexAdapter.bridgeChatStream(upstream, mockRes, 'deepseek-v4.1-flash', 'req_conv', () => {
      streamFinished = true;
    });

    // Feed Responses API event stream format
    upstream.emit('data', Buffer.from('data: {"type":"response.reasoning_text.delta","delta":"思考过程步骤一"}\n\n', 'utf8'));
    upstream.emit('data', Buffer.from('data: {"type":"response.output_text.delta","delta":"正式回复结果"}\n\n', 'utf8'));
    upstream.emit('data', Buffer.from('data: {"type":"response.completed","response":{"usage":{"total_tokens":40}}}\n\n', 'utf8'));
    upstream.emit('end');

    assert.strictEqual(streamFinished, true);
    const output = mockRes.getWrittenOutput();

    // Verify ChatCompletions chunk structure
    assert.strictEqual(output.includes('"reasoning_content":"思考过程步骤一"'), true);
    assert.strictEqual(output.includes('"content":"正式回复结果"'), true);
    assert.strictEqual(output.includes('data: [DONE]'), true);
  });

  // -------------------------------------------------------------
  // SECTION 6: DeepSeek <think> Tag Split Streaming
  // -------------------------------------------------------------
  console.log('--- SECTION 6: DeepSeek <think> Tag Split Streaming ---');

  await test('6.1 bridgeResponsesStream handles split <think> and </think> across SSE chunks', async () => {
    const mockRes = createMockClientRes();
    const upstream = new EventEmitter();
    let streamFinished = false;

    codexAdapter.bridgeResponsesStream(upstream, mockRes, 'deepseek-v4.1-flash', 'req_think', () => {
      streamFinished = true;
    });

    // Deliberately split the opening <think> and closing </think> tags across chunk boundaries
    const chunks = [
      'data: {"choices":[{"delta":{"content":"<th"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ink>深度分析系统架构"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"，确认无死锁风险。</thin"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"k>最终执行方案确认完毕。"}}]}\n\n',
      'data: [DONE]\n\n'
    ];

    for (const c of chunks) {
      upstream.emit('data', Buffer.from(c, 'utf8'));
    }
    upstream.emit('end');

    assert.strictEqual(streamFinished, true);
    const events = mockRes.getParsedSSEEvents();

    let reasoningText = '';
    let finalAnswerText = '';

    for (const ev of events) {
      if (ev.event === 'response.reasoning_text.delta') {
        const parsed = JSON.parse(ev.data);
        reasoningText += parsed.delta;
      } else if (ev.event === 'response.output_text.delta') {
        const parsed = JSON.parse(ev.data);
        finalAnswerText += parsed.delta;
      }
    }

    assert.strictEqual(reasoningText.includes('深度分析系统架构，确认无死锁风险。'), true, 'Reasoning text must be captured in reasoning part');
    assert.strictEqual(finalAnswerText.includes('最终执行方案确认完毕。'), true, 'Final answer must be captured in output part');
    assert.strictEqual(finalAnswerText.includes('<think>'), false, '<think> tag must not leak into final answer text');
    assert.strictEqual(finalAnswerText.includes('</think>'), false, '</think> tag must not leak into final answer text');
  });

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TIER 7 ADVERSARIAL TESTS PASSED!`);
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('Fatal error in Tier 7 test suite:', err);
  process.exit(1);
});
