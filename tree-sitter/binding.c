#include <stdlib.h>
#include "tree_sitter/api.h"

#define EXPORT(name) __attribute__((export_name(#name)))

const TSLanguage *tree_sitter_markdown(void);
const TSLanguage *tree_sitter_markdown_inline(void);

static TSParser *parser;
static TSQueryCursor *query_cursor;

EXPORT(hm_malloc) void *hm_malloc(size_t size) { return malloc(size); }
EXPORT(hm_free) void hm_free(void *ptr) { free(ptr); }

EXPORT(hm_language) const TSLanguage *hm_language(uint32_t which) {
  return which == 0 ? tree_sitter_markdown() : tree_sitter_markdown_inline();
}

EXPORT(hm_symbol_name) const char *hm_symbol_name(const TSLanguage *language, uint32_t symbol) {
  return ts_language_symbol_name(language, (TSSymbol)symbol);
}

EXPORT(hm_parse)
TSTree *hm_parse(const TSLanguage *language, const char *text, uint32_t length, const TSRange *ranges, uint32_t count, const TSTree *old_tree) {
  if (!parser) parser = ts_parser_new();
  if (!ts_parser_set_language(parser, language)) return NULL;
  if (!ts_parser_set_included_ranges(parser, count ? ranges : NULL, count)) return NULL;
  return ts_parser_parse_string(parser, old_tree, text, length);
}

EXPORT(hm_tree_edit) void hm_tree_edit(TSTree *tree, uint32_t start, uint32_t old_end, uint32_t new_end) {
  TSInputEdit edit = {start, old_end, new_end, {0, 0}, {0, 0}, {0, 0}};
  ts_tree_edit(tree, &edit);
}

EXPORT(hm_tree_delete) void hm_tree_delete(TSTree *tree) { ts_tree_delete(tree); }
EXPORT(hm_tree_root) void hm_tree_root(const TSTree *tree, TSNode *out) { *out = ts_tree_root_node(tree); }

EXPORT(hm_node_start) uint32_t hm_node_start(const TSNode *node) { return ts_node_start_byte(*node); }
EXPORT(hm_node_end) uint32_t hm_node_end(const TSNode *node) { return ts_node_end_byte(*node); }
EXPORT(hm_node_symbol) uint32_t hm_node_symbol(const TSNode *node) { return ts_node_symbol(*node); }
EXPORT(hm_node_is_named) uint32_t hm_node_is_named(const TSNode *node) { return ts_node_is_named(*node); }
EXPORT(hm_node_child_count) uint32_t hm_node_child_count(const TSNode *node) { return ts_node_child_count(*node); }
EXPORT(hm_node_child) void hm_node_child(const TSNode *node, uint32_t index, TSNode *out) { *out = ts_node_child(*node, index); }
EXPORT(hm_node_parent) void hm_node_parent(const TSNode *node, TSNode *out) { *out = ts_node_parent(*node); }
EXPORT(hm_node_next_sibling) void hm_node_next_sibling(const TSNode *node, TSNode *out) { *out = ts_node_next_sibling(*node); }
EXPORT(hm_node_prev_sibling) void hm_node_prev_sibling(const TSNode *node, TSNode *out) { *out = ts_node_prev_sibling(*node); }

EXPORT(hm_node_descendant)
void hm_node_descendant(const TSNode *node, uint32_t start, uint32_t end, uint32_t named, TSNode *out) {
  *out = named ? ts_node_named_descendant_for_byte_range(*node, start, end)
               : ts_node_descendant_for_byte_range(*node, start, end);
}

EXPORT(hm_cursor_new) TSTreeCursor *hm_cursor_new(const TSNode *node) {
  TSTreeCursor *cursor = malloc(sizeof(TSTreeCursor));
  *cursor = ts_tree_cursor_new(*node);
  return cursor;
}

EXPORT(hm_cursor_delete) void hm_cursor_delete(TSTreeCursor *cursor) {
  ts_tree_cursor_delete(cursor);
  free(cursor);
}

EXPORT(hm_cursor_node) void hm_cursor_node(const TSTreeCursor *cursor, TSNode *out) { *out = ts_tree_cursor_current_node(cursor); }
EXPORT(hm_cursor_parent) uint32_t hm_cursor_parent(TSTreeCursor *cursor) { return ts_tree_cursor_goto_parent(cursor); }
EXPORT(hm_cursor_first_child) uint32_t hm_cursor_first_child(TSTreeCursor *cursor) { return ts_tree_cursor_goto_first_child(cursor); }
EXPORT(hm_cursor_next_sibling) uint32_t hm_cursor_next_sibling(TSTreeCursor *cursor) { return ts_tree_cursor_goto_next_sibling(cursor); }
EXPORT(hm_cursor_prev_sibling) uint32_t hm_cursor_prev_sibling(TSTreeCursor *cursor) { return ts_tree_cursor_goto_previous_sibling(cursor); }

EXPORT(hm_cursor_first_child_for_byte) uint32_t hm_cursor_first_child_for_byte(TSTreeCursor *cursor, uint32_t goal) {
  return ts_tree_cursor_goto_first_child_for_byte(cursor, goal) >= 0;
}

EXPORT(hm_query_new) TSQuery *hm_query_new(const TSLanguage *language, const char *source, uint32_t length) {
  uint32_t error_offset;
  TSQueryError error_type;
  return ts_query_new(language, source, length, &error_offset, &error_type);
}

EXPORT(hm_query_capture_count) uint32_t hm_query_capture_count(const TSQuery *query) { return ts_query_capture_count(query); }
EXPORT(hm_query_pattern_count) uint32_t hm_query_pattern_count(const TSQuery *query) { return ts_query_pattern_count(query); }

EXPORT(hm_query_capture_name) const char *hm_query_capture_name(const TSQuery *query, uint32_t index, uint32_t *length) {
  return ts_query_capture_name_for_id(query, index, length);
}

EXPORT(hm_query_string) const char *hm_query_string(const TSQuery *query, uint32_t index, uint32_t *length) {
  return ts_query_string_value_for_id(query, index, length);
}

EXPORT(hm_query_predicates) const TSQueryPredicateStep *hm_query_predicates(const TSQuery *query, uint32_t pattern, uint32_t *length) {
  return ts_query_predicates_for_pattern(query, pattern, length);
}

EXPORT(hm_injection_matches)
uint32_t hm_injection_matches(
  const TSQuery *query,
  const TSNode *node,
  const uint8_t *modes,
  uint32_t content_id,
  uint32_t language_id,
  uint32_t shebang_id,
  uint32_t *buffer,
  uint32_t capacity
) {
  if (!query_cursor) {
    query_cursor = ts_query_cursor_new();
    ts_query_cursor_set_match_limit(query_cursor, 256);
  }
  ts_query_cursor_exec(query_cursor, query, *node);
  uint32_t used = 0;
  TSQueryMatch match;
  while (ts_query_cursor_next_match(query_cursor, &match)) {
    uint32_t lang_start = UINT32_MAX, lang_end = UINT32_MAX, shebang = 0;
    for (uint16_t i = 0; i < match.capture_count; i++) {
      if (match.captures[i].index == language_id) {
        lang_start = ts_node_start_byte(match.captures[i].node);
        lang_end = ts_node_end_byte(match.captures[i].node);
      } else if (match.captures[i].index == shebang_id) {
        shebang = 1;
      }
    }
    for (uint16_t i = 0; i < match.capture_count; i++) {
      if (match.captures[i].index != content_id) continue;
      TSNode content = match.captures[i].node;
      uint8_t mode = modes[match.pattern_index];
      uint32_t children = ts_node_child_count(content);
      uint32_t header = used;
      uint32_t excluded = 0;
      used += 8;
      for (uint32_t c = 0; c < children; c++) {
        TSNode child = ts_node_child(content, c);
        if (mode == 1 || (mode == 2 && !ts_node_is_named(child))) continue;
        if (used + 2 <= capacity) {
          buffer[used] = ts_node_start_byte(child);
          buffer[used + 1] = ts_node_end_byte(child);
        }
        used += 2;
        excluded++;
      }
      if (header + 8 <= capacity) {
        buffer[header] = match.pattern_index;
        buffer[header + 1] = ts_node_start_byte(content);
        buffer[header + 2] = ts_node_end_byte(content);
        buffer[header + 3] = lang_start;
        buffer[header + 4] = lang_end;
        buffer[header + 5] = shebang;
        buffer[header + 6] = excluded;
        buffer[header + 7] = 0;
      }
    }
  }
  return used;
}
