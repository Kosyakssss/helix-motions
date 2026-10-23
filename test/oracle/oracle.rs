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

    async fn run_case(input: &str, keys: &str) -> Value {
        let (text, selection) = test::print(input);
        let mut app = match AppBuilder::new().build() {
            Ok(app) => app,
            Err(err) => return json!({ "error": err.to_string() }),
        };
        {
            let (view, doc) = current!(app.editor);
            let sel = doc.selection(view.id).clone();
            let transaction = helix_core::Transaction::change_by_selection(doc.text(), &sel, |_| {
                (0, doc.text().len_chars(), Some(text.as_str().into()))
            })
            .with_selection(selection);
            doc.apply(&transaction, view.id);
            doc.append_changes_to_history(view);
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
            let handle = std::thread::spawn(move || {
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                rt.block_on(run_case(&input, &keys))
            });
            let mut result = match handle.join() {
                Ok(v) => v,
                Err(_) => json!({ "error": "panic" }),
            };
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
