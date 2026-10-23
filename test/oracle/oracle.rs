#[cfg(feature = "integration")]
mod test {
    #[path = "../test/helpers.rs"]
    #[allow(dead_code)]
    mod helpers;

    use helix_core::test;
    use helix_term::application::Application;
    use helix_view::{current, current_ref, document::Mode};
    use serde_json::{json, Value};

    use self::helpers::*;

    fn snapshot(app: &Application) -> Value {
        let (view, doc) = current_ref!(app.editor);
        let mode = match app.editor.mode {
            Mode::Normal => "normal",
            Mode::Insert => "insert",
            Mode::Select => "select",
        };
        let reg = app
            .editor
            .registers
            .read('"', &app.editor)
            .map(|values| values.map(|v| v.to_string()).collect::<Vec<_>>());
        let sel = doc.selection(view.id);
        let ranges: Vec<[usize; 2]> = sel.ranges().iter().map(|r| [r.anchor, r.head]).collect();
        json!({
            "text": doc.text().to_string(),
            "ranges": ranges,
            "primary": sel.primary_index(),
            "out": test::plain(doc.text().slice(..), doc.selection(view.id)),
            "mode": mode,
            "register": reg,
        })
    }

    fn markdown_loader() -> helix_core::syntax::Loader {
        let mut lang = helix_loader::config::default_lang_config();
        if let Some(languages) = lang.get_mut("language").and_then(|v| v.as_array_mut()) {
            languages.retain(|l| {
                matches!(l.get("name").and_then(|n| n.as_str()), Some("markdown" | "markdown.inline"))
            });
            for language in languages.iter_mut() {
                let table = language.as_table_mut().unwrap();
                table.insert("language-servers".into(), toml::Value::Array(Vec::new()));
                if table.contains_key("indent") {
                    let mut indent = toml::map::Map::new();
                    indent.insert("tab-width".into(), toml::Value::Integer(4));
                    indent.insert("unit".into(), toml::Value::String("\t".into()));
                    table.insert("indent".into(), toml::Value::Table(indent));
                }
            }
        }
        helix_core::syntax::Loader::new(lang.try_into().unwrap()).unwrap()
    }

    async fn run_case(input: &str, keys: &str, lang: Option<&str>) -> Value {
        let (text, selection) = test::print(input);
        let builder = match lang {
            Some(_) => AppBuilder::new().with_lang_loader(markdown_loader()),
            None => AppBuilder::new(),
        };
        let mut app = match builder.build() {
            Ok(app) => app,
            Err(err) => return json!({ "error": err.to_string() }),
        };
        {
            let loader = app.editor.syn_loader.load_full();
            let (view, doc) = current!(app.editor);
            let sel = doc.selection(view.id).clone();
            let transaction = helix_core::Transaction::change_by_selection(doc.text(), &sel, |_| {
                (0, doc.text().len_chars(), Some(text.as_str().into()))
            })
            .with_selection(selection);
            doc.apply(&transaction, view.id);
            doc.append_changes_to_history(view);
            if let Some(lang) = lang {
                if let Err(err) = doc.set_language_by_language_id(lang, &loader) {
                    return json!({ "error": err.to_string() });
                }
                if doc.syntax().is_none() {
                    return json!({ "error": "no syntax" });
                }
            }
        }
        let captured = std::cell::RefCell::new(Value::Null);
        let outcome = test_key_sequence(
            &mut app,
            Some(keys),
            Some(&|app: &Application| {
                *captured.borrow_mut() = snapshot(app);
            }),
            false,
        )
        .await;
        let mut result = captured.into_inner();
        if result.is_null() {
            result = json!({});
        }
        if let Err(err) = outcome {
            if result.get("out").is_none() {
                result["error"] = json!(err.to_string());
            }
        }
        result
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn oracle() -> anyhow::Result<()> {
        let input_path = std::env::var("ORACLE_IN")?;
        let output_path = std::env::var("ORACLE_OUT")?;
        let cases: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(input_path)?)?;
        let mut results = Vec::new();
        for case in cases {
            let input = case["in"].as_str().unwrap_or_default().to_string();
            let keys = case["keys"].as_str().unwrap_or_default().to_string();
            let lang = case["lang"].as_str().map(str::to_string);
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let rt = tokio::runtime::Builder::new_multi_thread()
                        .enable_all()
                        .build()
                        .unwrap();
                    rt.block_on(run_case(&input, &keys, lang.as_deref()))
                }));
                let _ = tx.send(outcome.unwrap_or_else(|_| json!({ "error": "panic" })));
            });
            let mut result = rx
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap_or_else(|_| json!({ "error": "timeout" }));
            result["id"] = case["id"].clone();
            results.push(result);
        }
        std::fs::write(output_path, serde_json::to_string_pretty(&results)?)?;
        Ok(())
    }
}

#[cfg(feature = "integration")]
mod widths {
    use helix_core::graphemes::grapheme_width;

    #[test]
    fn widths() {
        let Ok(path) = std::env::var("ORACLE_WIDTHS") else { return };
        let mut ranges: Vec<(u32, u32, usize)> = Vec::new();
        let mut presentation: Vec<u32> = Vec::new();
        for cp in 0x80u32..=0x10FFFF {
            let Some(c) = char::from_u32(cp) else { continue };
            let s = format!("\u{e9}{c}");
            let w = grapheme_width(&s) - 1;
            match ranges.last_mut() {
                Some(last) if last.2 == w && last.1 + 1 == cp => last.1 = cp,
                _ => ranges.push((cp, cp, w)),
            }
            let seq = format!("{c}\u{FE0F}");
            if grapheme_width(&seq) == 2 && grapheme_width(&c.to_string()) != 2 {
                presentation.push(cp);
            }
        }
        let ranges: Vec<_> = ranges.into_iter().filter(|r| r.2 != 1).map(|r| [r.0, r.1, r.2 as u32]).collect();
        std::fs::write(path, serde_json::to_string(&serde_json::json!({"ranges": ranges, "presentation": presentation})).unwrap()).unwrap();
    }
}
