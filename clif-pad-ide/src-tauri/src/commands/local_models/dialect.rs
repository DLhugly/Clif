//! Per-architecture chat + tool-call dialects.
//!
//! Local models don't share a tool protocol the way cloud APIs do. Each family
//! bakes its own into training, and a model prompted in the wrong dialect degrades
//! badly — Gemma 4 fed a Gemma 2/3 prompt produces confused output and emits tool
//! calls we can't read. llama.cpp's `llama_chat_apply_template` is a hardcoded C
//! matcher (not a Jinja engine), so it silently fails to render newer templates and
//! we have to know the dialect ourselves.
//!
//! One `Dialect` therefore owns everything format-specific: how turns are framed,
//! where generation must stop, and how a tool call is written and read back.

use serde_json::{json, Map, Value};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dialect {
    /// Gemma 4: `<|turn>role … <turn|>`, tool calls as
    /// `<|tool_call>call:name{k:v}<tool_call|>` with unquoted keys and `<|"|>`
    /// string delimiters. Has a thinking channel.
    Gemma4,
    /// Gemma 2/3: `<start_of_turn>role … <end_of_turn>`, no system role.
    Gemma,
    /// ChatML — native to Qwen/Hermes and understood almost everywhere else.
    ChatMl,
}

impl Dialect {
    pub fn for_arch(arch: &str) -> Self {
        let a = arch.to_lowercase();
        // Order matters: "gemma4" also contains "gemma".
        if a.starts_with("gemma4") || a.starts_with("gemma-4") {
            Dialect::Gemma4
        } else if a.contains("gemma") {
            Dialect::Gemma
        } else {
            Dialect::ChatMl
        }
    }

    /// Strings that must end generation: the close of a tool call, or of a turn.
    /// Without these the model runs past its own tool call and burns tokens.
    pub fn stop_sequences(&self) -> Vec<String> {
        let mut v = vec![
            // The generic protocol we teach in the prompt, honoured by most models.
            "</tool_call>".to_string(),
        ];
        match self {
            Dialect::Gemma4 => {
                v.push("<tool_call|>".to_string());
                v.push("<turn|>".to_string());
            }
            Dialect::Gemma => v.push("<end_of_turn>".to_string()),
            Dialect::ChatMl => v.push("<|im_end|>".to_string()),
        }
        v
    }

    /// Markers that open tool-call markup. Everything from the first one onward is
    /// withheld from the chat bubble — it's protocol, not prose.
    pub fn tool_call_openers(&self) -> Vec<&'static str> {
        match self {
            Dialect::Gemma4 => vec!["<tool_call>", "<|tool_call>"],
            _ => vec!["<tool_call>"],
        }
    }

    /// (open, close) spans of internal reasoning that must never reach the chat.
    /// Gemma 4 emits a thinking channel; several other open models use `<think>`.
    /// Unlike a tool-call opener, these are *spans* — prose resumes after the close.
    pub fn hidden_spans(&self) -> Vec<(&'static str, &'static str)> {
        match self {
            Dialect::Gemma4 => vec![
                ("<|channel>", "<channel|>"),
                ("<think>", "</think>"),
            ],
            _ => vec![("<think>", "</think>")],
        }
    }

    /// Drop hidden reasoning from text destined for conversation history. The model's
    /// own template strips thinking from prior assistant turns; if we replayed it,
    /// the model would treat its scratchpad as committed output.
    pub fn strip_hidden(&self, text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut rest = text;

        'outer: loop {
            // Earliest hidden-span opener in what remains.
            let Some((idx, open, close)) = self
                .hidden_spans()
                .iter()
                .filter_map(|(o, c)| rest.find(o).map(|i| (i, *o, *c)))
                .min_by_key(|(i, _, _)| *i)
            else {
                break 'outer;
            };

            out.push_str(&rest[..idx]);
            let after = &rest[idx + open.len()..];
            match after.find(close) {
                Some(end) => rest = &after[end + close.len()..],
                // Unterminated span (hit the token cap) — everything after is thinking.
                None => return out,
            }
        }

        out.push_str(rest);
        out
    }

    /// Render a conversation into a prompt in this dialect. BOS is added by the
    /// tokenizer (`AddBos::Always`), so it is never written here.
    pub fn render(&self, messages: &[(String, String)]) -> String {
        match self {
            Dialect::Gemma4 => render_gemma4(messages),
            Dialect::Gemma => render_gemma(messages),
            Dialect::ChatMl => render_chatml(messages),
        }
    }

    /// Wrap a tool result so the model reads it back in its own format.
    pub fn format_tool_response(&self, name: &str, result: &str) -> String {
        match self {
            Dialect::Gemma4 => format!(
                "<|tool_response>response:{name}{{value:<|\"|>{result}<|\"|>}}<tool_response|>"
            ),
            _ => format!("<tool_response>\n{result}\n</tool_response>"),
        }
    }
}

// ---- prompt rendering ------------------------------------------------------

fn render_chatml(messages: &[(String, String)]) -> String {
    let mut s = String::new();
    for (role, content) in messages.iter().filter(|(_, c)| !c.trim().is_empty()) {
        s.push_str(&format!("<|im_start|>{role}\n{content}<|im_end|>\n"));
    }
    s.push_str("<|im_start|>assistant\n");
    s
}

/// Gemma 2/3: no system role (folded into the first user turn), assistant = "model".
fn render_gemma(messages: &[(String, String)]) -> String {
    let mut s = String::new();
    for (role, content) in fold_system_into_user(messages)
        .iter()
        .filter(|(_, c)| !c.trim().is_empty())
    {
        let turn = if role == "assistant" { "model" } else { "user" };
        s.push_str(&format!("<start_of_turn>{turn}\n{content}<end_of_turn>\n"));
    }
    s.push_str("<start_of_turn>model\n");
    s
}

/// Gemma 4 keeps a real system turn, unlike Gemma 2/3.
fn render_gemma4(messages: &[(String, String)]) -> String {
    let mut s = String::new();
    let mut rest = messages;

    if let Some((role, content)) = messages.first() {
        if role == "system" && !content.trim().is_empty() {
            s.push_str("<|turn>system\n");
            s.push_str(content.trim());
            s.push_str("<turn|>\n");
            rest = &messages[1..];
        }
    }

    for (role, content) in rest.iter().filter(|(_, c)| !c.trim().is_empty()) {
        // Only the first turn may be `system`; anything later rides in as user.
        let turn = if role == "assistant" { "model" } else { "user" };
        s.push_str(&format!("<|turn>{turn}\n{}<turn|>\n", content.trim()));
    }

    // End at the turn header and let the model speak in its own trained format —
    // including opening a thought channel if it wants to. We used to prime this with a
    // hand-written, already-closed `<|channel>thought<channel|>` block to suppress
    // thinking. That was off-distribution guesswork: the model imitated the block back
    // at us, malformed (`<thought`, a bare `<channel|>`), and once that debris entered
    // the history it compounded into a loop that burned the whole token budget.
    // Thinking is hidden downstream by `hidden_spans`/`strip_hidden` instead.
    s.push_str("<|turn>model\n");
    s
}

/// Fold all `system` messages into the first `user` turn, for templates with no
/// system role (Gemma 2/3).
fn fold_system_into_user(messages: &[(String, String)]) -> Vec<(String, String)> {
    let system: String = messages
        .iter()
        .filter(|(r, _)| r == "system")
        .map(|(_, c)| c.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    let mut out: Vec<(String, String)> = Vec::new();
    let mut injected = system.is_empty();
    for (role, content) in messages.iter().filter(|(r, _)| r != "system") {
        if !injected && role == "user" {
            out.push(("user".to_string(), format!("{system}\n\n{content}")));
            injected = true;
        } else {
            out.push((role.clone(), content.clone()));
        }
    }
    if !injected {
        out.insert(0, ("user".to_string(), system));
    }
    out
}

// ---- Gemma 4 tool-call parsing ---------------------------------------------

/// Parse `call:NAME{args}` bodies out of Gemma 4's native tool-call markup.
///
/// The argument syntax is *not* JSON: keys are unquoted and strings are delimited
/// by `<|"|>` rather than double quotes, e.g.
/// `call:read_file{path:<|"|>src/main.rs<|"|>,limit:20}`.
pub fn parse_gemma4_tool_calls(text: &str) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    let mut rest = text;

    while let Some(start) = rest.find("<|tool_call>") {
        let after = &rest[start + "<|tool_call>".len()..];
        // Generation may have been cut at the token cap, leaving no closing tag.
        let (body, next) = match after.find("<tool_call|>") {
            Some(end) => (&after[..end], &after[end + "<tool_call|>".len()..]),
            None => (after, ""),
        };

        if let Some(call) = parse_gemma4_call(body.trim()) {
            out.push(call);
        }
        if next.is_empty() {
            break;
        }
        rest = next;
    }
    out
}

fn parse_gemma4_call(body: &str) -> Option<(String, Value)> {
    let body = body.strip_prefix("call:").unwrap_or(body);
    let brace = body.find('{')?;
    let name = body[..brace].trim().to_string();
    if name.is_empty() {
        return None;
    }
    let mut p = Parser { s: body, i: brace };
    let args = p.object()?;
    Some((name, args))
}

/// Recursive-descent parser for Gemma's pseudo-JSON argument syntax.
struct Parser<'a> {
    s: &'a str,
    i: usize,
}

const QUOTE: &str = "<|\"|>";

impl<'a> Parser<'a> {
    fn rest(&self) -> &'a str {
        &self.s[self.i..]
    }

    fn skip_ws(&mut self) {
        while let Some(c) = self.rest().chars().next() {
            if c.is_whitespace() {
                self.i += c.len_utf8();
            } else {
                break;
            }
        }
    }

    fn eat(&mut self, tok: &str) -> bool {
        if self.rest().starts_with(tok) {
            self.i += tok.len();
            true
        } else {
            false
        }
    }

    fn object(&mut self) -> Option<Value> {
        self.skip_ws();
        if !self.eat("{") {
            return None;
        }
        let mut map = Map::new();
        loop {
            self.skip_ws();
            if self.eat("}") {
                break;
            }
            let key = self.key()?;
            self.skip_ws();
            if !self.eat(":") {
                return None;
            }
            let val = self.value()?;
            map.insert(key, val);
            self.skip_ws();
            if self.eat(",") {
                continue;
            }
            if self.eat("}") {
                break;
            }
            // Unterminated (token cap) — keep what we parsed rather than fail.
            break;
        }
        Some(Value::Object(map))
    }

    fn array(&mut self) -> Option<Value> {
        self.skip_ws();
        if !self.eat("[") {
            return None;
        }
        let mut items = Vec::new();
        loop {
            self.skip_ws();
            if self.eat("]") {
                break;
            }
            items.push(self.value()?);
            self.skip_ws();
            if self.eat(",") {
                continue;
            }
            if self.eat("]") {
                break;
            }
            break;
        }
        Some(Value::Array(items))
    }

    fn key(&mut self) -> Option<String> {
        self.skip_ws();
        if self.rest().starts_with(QUOTE) || self.rest().starts_with('"') {
            return self.string();
        }
        // Bare key: read up to ':'.
        let end = self.rest().find(':')?;
        let k = self.rest()[..end].trim().to_string();
        self.i += end;
        if k.is_empty() {
            None
        } else {
            Some(k)
        }
    }

    fn string(&mut self) -> Option<String> {
        self.skip_ws();
        if self.eat(QUOTE) {
            // Raw content up to the closing marker — no escape processing, which is
            // what lets file contents with quotes and newlines survive intact.
            let end = self.rest().find(QUOTE)?;
            let s = self.rest()[..end].to_string();
            self.i += end + QUOTE.len();
            return Some(s);
        }
        if self.eat("\"") {
            let mut out = String::new();
            let mut escaped = false;
            loop {
                let c = self.rest().chars().next()?;
                self.i += c.len_utf8();
                if escaped {
                    out.push(match c {
                        'n' => '\n',
                        't' => '\t',
                        'r' => '\r',
                        other => other,
                    });
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if c == '"' {
                    break;
                } else {
                    out.push(c);
                }
            }
            return Some(out);
        }
        None
    }

    fn value(&mut self) -> Option<Value> {
        self.skip_ws();
        let r = self.rest();
        if r.starts_with(QUOTE) || r.starts_with('"') {
            return self.string().map(Value::String);
        }
        if r.starts_with('{') {
            return self.object();
        }
        if r.starts_with('[') {
            return self.array();
        }
        // Bare scalar: run to the next structural character.
        let end = r
            .find(|c| c == ',' || c == '}' || c == ']')
            .unwrap_or(r.len());
        let raw = r[..end].trim().to_string();
        self.i += end;

        Some(match raw.as_str() {
            "true" => json!(true),
            "false" => json!(false),
            "null" => Value::Null,
            _ => {
                if let Ok(i) = raw.parse::<i64>() {
                    json!(i)
                } else if let Ok(f) = raw.parse::<f64>() {
                    json!(f)
                } else {
                    Value::String(raw)
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_dialects() {
        assert_eq!(Dialect::for_arch("gemma4"), Dialect::Gemma4);
        assert_eq!(Dialect::for_arch("gemma3"), Dialect::Gemma);
        assert_eq!(Dialect::for_arch("gemma2"), Dialect::Gemma);
        assert_eq!(Dialect::for_arch("qwen2"), Dialect::ChatMl);
        assert_eq!(Dialect::for_arch("llama"), Dialect::ChatMl);
    }

    /// Gemma 4 must NOT get Gemma 2/3's `<start_of_turn>` framing — that mismatch is
    /// what degraded output and made the model emit unreadable tool calls.
    #[test]
    fn gemma4_uses_its_own_turn_format() {
        let msgs = vec![
            ("system".to_string(), "You are Clif.".to_string()),
            ("user".to_string(), "Hi".to_string()),
        ];
        let p = Dialect::Gemma4.render(&msgs);
        assert!(p.contains("<|turn>system\nYou are Clif.<turn|>"));
        assert!(p.contains("<|turn>user\nHi<turn|>"));
        assert!(!p.contains("<start_of_turn>"), "leaked Gemma 2/3 framing: {p}");

        // The prompt hands off at the bare turn header. We must NOT hand-write a thought
        // channel to prime it: the model opens a well-formed `<|channel>thought…<channel|>`
        // itself (verified against the real GGUF), and priming it with our guess made the
        // model imitate the guess back, malformed, until it burned the token budget.
        assert!(p.ends_with("<|turn>model\n"), "prompt must not prime the model: {p}");
        assert!(!p.contains("<|channel>"), "we do not author channel markup: {p}");
    }

    #[test]
    fn gemma2_still_uses_legacy_format() {
        let msgs = vec![("user".to_string(), "Hi".to_string())];
        let p = Dialect::Gemma.render(&msgs);
        assert!(p.contains("<start_of_turn>user"));
        assert!(!p.contains("<|turn>"));
    }

    #[test]
    fn parses_native_gemma4_tool_call() {
        let text = "<|tool_call>call:read_file{path:<|\"|>src/main.rs<|\"|>,limit:20}<tool_call|>";
        let calls = parse_gemma4_tool_calls(text);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "read_file");
        assert_eq!(calls[0].1["path"], "src/main.rs");
        assert_eq!(calls[0].1["limit"], 20);
    }

    /// The exact shape the model produced when it tried to build a website.
    #[test]
    fn parses_real_world_todo_write_call() {
        let text = "<|tool_call>call:todo_write{todos:[{content:<|\"|>Plan the site<|\"|>,\
                    id:<|\"|>plan<|\"|>,status:<|\"|>in_progress<|\"|>}]}<tool_call|>";
        let calls = parse_gemma4_tool_calls(text);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "todo_write");
        let todos = calls[0].1["todos"].as_array().expect("todos array");
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0]["content"], "Plan the site");
        assert_eq!(todos[0]["status"], "in_progress");
    }

    /// File contents carry quotes, braces and newlines — they must survive the
    /// raw-string path without being mangled.
    #[test]
    fn parses_content_with_quotes_and_braces() {
        let text = "<|tool_call>call:write_file{path:<|\"|>a.html<|\"|>,\
                    content:<|\"|><div class=\"x\">{hi}\nline2</div><|\"|>}<tool_call|>";
        let calls = parse_gemma4_tool_calls(text);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].1["content"], "<div class=\"x\">{hi}\nline2</div>");
    }

    #[test]
    fn parses_booleans_and_unterminated_calls() {
        let calls = parse_gemma4_tool_calls("<|tool_call>call:search{deep:true,n:3}");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].1["deep"], true);
        assert_eq!(calls[0].1["n"], 3);
    }

    #[test]
    fn prose_yields_no_calls() {
        assert!(parse_gemma4_tool_calls("Sure, here's the plan.").is_empty());
    }

    #[test]
    fn gemma4_stops_on_its_own_markers() {
        let s = Dialect::Gemma4.stop_sequences();
        assert!(s.iter().any(|x| x == "<tool_call|>"));
        assert!(s.iter().any(|x| x == "<turn|>"));
    }
}
