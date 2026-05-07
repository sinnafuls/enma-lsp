/**
 * External scanner for Enma — handles §A2 f-string boundary tokens.
 *
 * Token IDs must match the order in grammar.js externals array:
 *   0: fstring_start
 *   1: fstring_text
 *   2: fstring_expr_open
 *   3: fstring_expr_close
 *   4: fstring_end
 *
 * Nested f-strings are handled via a depth stack: each entry holds the
 * brace_depth for that nesting level.  When a nested f" is opened inside
 * an interpolation we push a new level (brace_depth=0); when the inner
 * fstring_end fires we pop back to the outer level.
 */

#include "tree_sitter/parser.h"
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>

#define MAX_FSTRING_DEPTH 8

typedef enum {
  FSTRING_START,
  FSTRING_TEXT,
  FSTRING_EXPR_OPEN,
  FSTRING_EXPR_CLOSE,
  FSTRING_END,
} TokenType;

typedef struct {
  uint8_t depth;                        /* current nesting level (0 = not in fstring) */
  uint8_t brace_depth[MAX_FSTRING_DEPTH]; /* brace nesting per fstring level */
} Scanner;

unsigned tree_sitter_enma_external_scanner_serialize(void *payload, char *buffer) {
  Scanner *s = (Scanner *)payload;
  buffer[0] = s->depth;
  for (int i = 0; i < MAX_FSTRING_DEPTH; i++) {
    buffer[1 + i] = s->brace_depth[i];
  }
  return 1 + MAX_FSTRING_DEPTH;
}

void tree_sitter_enma_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *s = (Scanner *)payload;
  s->depth = 0;
  memset(s->brace_depth, 0, sizeof(s->brace_depth));
  if (length >= 1) s->depth = buffer[0];
  for (unsigned i = 0; i < MAX_FSTRING_DEPTH && (1 + i) < length; i++) {
    s->brace_depth[i] = (uint8_t)buffer[1 + i];
  }
}

void *tree_sitter_enma_external_scanner_create(void) {
  return calloc(1, sizeof(Scanner));
}

void tree_sitter_enma_external_scanner_destroy(void *payload) {
  free(payload);
}

static void skip_whitespace(TSLexer *lexer) {
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
         lexer->lookahead == '\n' || lexer->lookahead == '\r') {
    lexer->advance(lexer, true);
  }
}

bool tree_sitter_enma_external_scanner_scan(
    void *payload,
    TSLexer *lexer,
    const bool *valid_symbols)
{
  Scanner *s = (Scanner *)payload;

  skip_whitespace(lexer);

  /* FSTRING_START: f" — intercept at any nesting level (including inside
   * an active interpolation brace) before main lexer sees 'f' as identifier */
  if (valid_symbols[FSTRING_START] && lexer->lookahead == 'f') {
    lexer->mark_end(lexer);
    lexer->advance(lexer, false);
    if (lexer->lookahead == '"') {
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      /* push new depth level */
      if (s->depth < MAX_FSTRING_DEPTH) {
        s->depth++;
        s->brace_depth[s->depth - 1] = 0;
      }
      lexer->result_symbol = FSTRING_START;
      return true;
    }
    return false;
  }

  if (s->depth > 0) {
    uint8_t bd = s->brace_depth[s->depth - 1];

    /* FSTRING_END: closing " at text level of current depth */
    if (valid_symbols[FSTRING_END] && bd == 0 && lexer->lookahead == '"') {
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      s->depth--;
      lexer->result_symbol = FSTRING_END;
      return true;
    }

    /* FSTRING_EXPR_OPEN: { at text level */
    if (valid_symbols[FSTRING_EXPR_OPEN] && bd == 0 && lexer->lookahead == '{') {
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      s->brace_depth[s->depth - 1] = 1;
      lexer->result_symbol = FSTRING_EXPR_OPEN;
      return true;
    }

    /* FSTRING_EXPR_CLOSE: } when brace_depth == 1 */
    if (valid_symbols[FSTRING_EXPR_CLOSE] && bd == 1 && lexer->lookahead == '}') {
      lexer->advance(lexer, false);
      lexer->mark_end(lexer);
      s->brace_depth[s->depth - 1] = 0;
      lexer->result_symbol = FSTRING_EXPR_CLOSE;
      return true;
    }

    /* FSTRING_TEXT: consume until { or " (only at text level) */
    if (valid_symbols[FSTRING_TEXT] && bd == 0) {
      if (lexer->lookahead == '{' || lexer->lookahead == '"' || lexer->lookahead == 0) {
        return false;
      }
      while (lexer->lookahead != '{' && lexer->lookahead != '"' && lexer->lookahead != 0) {
        if (lexer->lookahead == '\\') {
          lexer->advance(lexer, false);
          if (lexer->lookahead != 0) lexer->advance(lexer, false);
        } else {
          lexer->advance(lexer, false);
        }
      }
      lexer->mark_end(lexer);
      lexer->result_symbol = FSTRING_TEXT;
      return true;
    }

    return false;
  }

  return false;
}
