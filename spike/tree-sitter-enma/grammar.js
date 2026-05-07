/**
 * Tree-sitter grammar for Enma (M0.5 spike — Phase 3 parallel candidate)
 *
 * Covers enough of the language to parse samples/showcase.em and the §A6
 * synthetic corpus.
 *
 * §A2 f-string boundary contract: implemented via external scanner (scanner.c).
 * Template-call disambiguation: scanner emits TEMPLATE_LT / TEMPLATE_GT using
 * the tree-sitter-cpp lookahead heuristic (see scanner.c).
 */

module.exports = grammar({
  name: 'enma',

  externals: $ => [
    $.fstring_start,
    $.fstring_text,
    $.fstring_expr_open,
    $.fstring_expr_close,
    $.fstring_end,
  ],

  extras: $ => [
    $.line_comment,
    $.block_comment,
    /\s/,
  ],

  conflicts: $ => [
    // for-statement (init;cond;update) vs foreach-statement (T v : expr)
    [$.for_statement, $.foreach_statement],
    // designated initializer list vs block (both start with '{')
    [$.designated_initializer_list, $.block],
    // type_name vs identifier in expression context
    [$.type_name, $.identifier_expression],

    // function_declaration vs method_declaration (identical shape at top-level)
    [$.function_declaration, $.method_declaration],
    // constructor vs method (constructor has no return type)
    [$.constructor_declaration, $.method_declaration],
    // lambda_arrow (params) => expr  vs  parenthesized_expression (expr)
    [$.lambda_arrow, $.parenthesized_expression],
    // variable_declaration vs expression_statement (both can start with identifier)
    [$.variable_declaration, $.expression_statement],
    // qualified_type vs qualified_name_expression (both are id :: id)
    [$.qualified_type, $.qualified_name_expression],
    // array literal {e,e} vs designated initializer list {.f=e}
    [$.array_literal, $.designated_initializer_list],
    // lambda bracket [cap](p)->T{} vs array literal [e]
    [$.lambda_bracket, $.index_expression],
    // pointer_type T* in decl vs multiply *expr in expression
    [$.pointer_type, $.binary_expression],
    // new_expression: new T  vs  new T(args)
    [$.new_expression],
    // block {} vs array_literal {} inside a function body
    [$.block, $.array_literal],
  ],

  word: $ => $.identifier,

  rules: {

    // -----------------------------------------------------------------------
    // Top-level
    // -----------------------------------------------------------------------
    source_file: $ => repeat($._top_level_item),

    _top_level_item: $ => choice(
      $.preprocessor_directive,
      $.import_declaration,
      $.using_declaration,
      $.namespace_declaration,
      $.class_declaration,
      $.struct_declaration,
      $.interface_declaration,
      $.enum_declaration,
      $.delegate_declaration,
      $.template_declaration,
      $.extern_declaration,
      $.function_declaration,
      $.operator_declaration,
      $.mixin_declaration,
      $.typedef_declaration,
      $.variable_declaration,
      $.empty_statement,
    ),

    // -----------------------------------------------------------------------
    // Comments
    // -----------------------------------------------------------------------
    line_comment: $ => token(seq('//', /.*/)),

    // Block comment: closes at first */ (Enma comments are not nestable)
    block_comment: $ => token(seq(
      '/*',
      /[^*]*\*+([^/][^*]*\*+)*/,
      '/',
    )),

    // -----------------------------------------------------------------------
    // Preprocessor  (opaque single-line token)
    // -----------------------------------------------------------------------
    preprocessor_directive: $ => token(
      /#[ \t]*(include|define|undef|ifdef|ifndef|if|elif|else|endif|pragma)[^\n]*/,
    ),

    // -----------------------------------------------------------------------
    // Import / using
    // -----------------------------------------------------------------------
    import_declaration: $ => seq(
      'import',
      $.string_literal,
      ';',
    ),

    using_declaration: $ => seq(
      'using',
      choice(
        seq('namespace', $.identifier),
        seq($.identifier, '=', $._decl_type),
      ),
      ';',
    ),

    typedef_declaration: $ => seq(
      'typedef',
      $._decl_type,
      $.identifier,
      ';',
    ),

    // -----------------------------------------------------------------------
    // Annotations  [[name]]  [[name(arg)]]
    // -----------------------------------------------------------------------
    annotation_list: $ => repeat1($.annotation),

    annotation: $ => seq(
      '[[',
      $.identifier,
      optional(seq('(', optional($._annotation_arg), ')')),
      ']]',
    ),

    _annotation_arg: $ => choice(
      $.string_literal,
      $.number_literal,
      $.identifier,
    ),

    // -----------------------------------------------------------------------
    // Namespace
    // -----------------------------------------------------------------------
    namespace_declaration: $ => seq(
      'namespace',
      $.identifier,
      '{',
      repeat($._top_level_item),
      '}',
    ),

    // -----------------------------------------------------------------------
    // Enum
    // -----------------------------------------------------------------------
    enum_declaration: $ => seq(
      optional($.annotation_list),
      'enum',
      $.identifier,
      '{',
      commaSep($.enum_variant),
      optional(','),
      '}',
    ),

    enum_variant: $ => seq(
      $.identifier,
      optional(seq('=', $._expression)),
    ),

    // -----------------------------------------------------------------------
    // Delegate
    // -----------------------------------------------------------------------
    delegate_declaration: $ => seq(
      optional($.annotation_list),
      'delegate',
      $._decl_type,
      $.identifier,
      $.parameter_list,
      ';',
    ),

    // -----------------------------------------------------------------------
    // Interface
    // -----------------------------------------------------------------------
    interface_declaration: $ => seq(
      optional($.annotation_list),
      'interface',
      $.identifier,
      optional($.base_list),
      '{',
      repeat($._member_item),
      '}',
    ),

    // -----------------------------------------------------------------------
    // Struct
    // -----------------------------------------------------------------------
    struct_declaration: $ => seq(
      optional($.annotation_list),
      'struct',
      $.identifier,
      optional($.base_list),
      '{',
      repeat($._member_item),
      '}',
    ),

    // -----------------------------------------------------------------------
    // Class
    // -----------------------------------------------------------------------
    class_declaration: $ => seq(
      optional($.annotation_list),
      'class',
      $.identifier,
      optional($.base_list),
      '{',
      repeat($._member_item),
      '}',
    ),

    // Multi-inheritance: `: Base1, Base2`
    base_list: $ => seq(':', commaSep1($._decl_type)),

    // -----------------------------------------------------------------------
    // Template
    // -----------------------------------------------------------------------
    template_declaration: $ => seq(
      optional($.annotation_list),
      'template',
      '<',
      commaSep1($.template_parameter),
      '>',
      choice(
        $.function_declaration,
        $.class_declaration,
        $.struct_declaration,
      ),
    ),

    template_parameter: $ => seq(
      choice('typename', 'class'),
      $.identifier,
    ),

    // -----------------------------------------------------------------------
    // Extern
    // -----------------------------------------------------------------------
    extern_declaration: $ => seq(
      optional($.annotation_list),
      'extern',
      $._decl_type,
      $.identifier,
      $.parameter_list,
      ';',
    ),

    // -----------------------------------------------------------------------
    // Class members
    // -----------------------------------------------------------------------
    _member_item: $ => choice(
      $.constructor_declaration,
      $.destructor_declaration,
      $.method_declaration,
      $.field_declaration,
      $.operator_declaration,
      $.property_declaration,
    ),

    field_declaration: $ => seq(
      optional($.annotation_list),
      optional($.modifier_list),
      $._decl_type,
      $.identifier,
      optional(seq('[', $._expression, ']')),
      optional(seq('=', $._expression)),
      ';',
    ),

    method_declaration: $ => seq(
      optional($.annotation_list),
      optional($.modifier_list),
      $._decl_type,
      $.identifier,
      $.parameter_list,
      choice($.block, ';'),
    ),

    constructor_declaration: $ => seq(
      optional($.annotation_list),
      optional($.modifier_list),
      $.identifier,
      $.parameter_list,
      $.block,
    ),

    destructor_declaration: $ => seq(
      optional($.annotation_list),
      '~',
      $.identifier,
      '(',
      ')',
      $.block,
    ),

    operator_declaration: $ => seq(
      optional($.annotation_list),
      optional($.modifier_list),
      $._decl_type,
      'operator',
      $._op_sym,
      $.parameter_list,
      choice($.block, ';'),
    ),

    _op_sym: $ => choice(
      '+', '-', '*', '/', '%',
      '==', '!=', '<=', '>=',
      '&&', '||', '!',
      '&', '|', '^', '~',
      '<<', '>>',
    ),

    // mixin TypeName::methodName(params) { body }
    mixin_declaration: $ => seq(
      'mixin',
      $._decl_type,
      $.identifier,
      '::',
      $.identifier,
      $.parameter_list,
      $.block,
    ),

    property_declaration: $ => seq(
      optional($.annotation_list),
      optional($.modifier_list),
      'property',
      $._decl_type,
      $.identifier,
      '{',
      optional($.getter_clause),
      optional($.setter_clause),
      '}',
    ),

    getter_clause: $ => seq('get', $.block),
    setter_clause: $ => seq('set', $.block),

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------
    modifier_list: $ => repeat1($._modifier),

    _modifier: $ => choice(
      'static', 'const', 'constexpr', 'override',
      'public', 'private',
      'inline', 'volatile', 'nullable', 'out',
      'coroutine',
    ),

    // -----------------------------------------------------------------------
    // Free function
    // -----------------------------------------------------------------------
    function_declaration: $ => seq(
      optional($.annotation_list),
      optional($.modifier_list),
      $._decl_type,
      $.identifier,
      $.parameter_list,
      choice($.block, ';'),
    ),

    // -----------------------------------------------------------------------
    // Parameters
    // -----------------------------------------------------------------------
    parameter_list: $ => seq(
      '(',
      choice(
        seq(commaSep($.parameter), optional(seq(optional(','), $.variadic_param))),
        $.variadic_param,
        /* empty */
      ),
      ')',
    ),

    parameter: $ => seq(
      optional($._modifier),
      $._decl_type,
      optional($.identifier),
      optional(seq('=', $._expression)),
    ),

    variadic_param: $ => '...',

    // -----------------------------------------------------------------------
    // Variable declaration
    // -----------------------------------------------------------------------
    variable_declaration: $ => seq(
      optional($.modifier_list),
      $._decl_type,
      $.identifier,
      optional(seq('=', $._expression)),
      ';',
    ),

    // -----------------------------------------------------------------------
    // Statements
    // -----------------------------------------------------------------------
    _statement: $ => choice(
      $.block,
      $.if_statement,
      $.for_statement,
      $.foreach_statement,
      $.while_statement,
      $.do_while_statement,
      $.switch_statement,
      $.try_statement,
      $.defer_statement,
      $.return_statement,
      $.yield_statement,
      $.throw_statement,
      $.break_statement,
      $.continue_statement,
      $.goto_statement,
      $.label_statement,
      $.variable_declaration,
      $.expression_statement,
      $.empty_statement,
    ),

    block: $ => seq('{', repeat($._statement), '}'),

    empty_statement: $ => ';',

    if_statement: $ => prec.right(seq(
      'if', '(', $._expression, ')',
      $._statement,
      optional(seq('else', $._statement)),
    )),

    // Counted for: for (T id = expr; cond; update)  or  for (expr; cond; update)
    for_statement: $ => seq(
      'for', '(',
      choice(
        seq($._decl_type, $.identifier, '=', $._expression, ';'),
        seq($._expression, ';'),
        ';',
      ),
      optional($._expression), ';',
      optional($._expression),
      ')', $._statement,
    ),

    // Range-based: for (T id : expr)
    foreach_statement: $ => seq(
      'for', '(',
      $._decl_type, $.identifier, ':', $._expression,
      ')', $._statement,
    ),

    while_statement: $ => seq(
      'while', '(', $._expression, ')', $._statement,
    ),

    do_while_statement: $ => seq(
      'do', $._statement, 'while', '(', $._expression, ')', ';',
    ),

    switch_statement: $ => seq(
      'switch', '(', $._expression, ')',
      '{', repeat(choice($.case_clause, $.default_clause)), '}',
    ),

    case_clause: $ => seq('case', $._expression, ':', repeat($._statement)),
    default_clause: $ => seq('default', ':', repeat($._statement)),

    try_statement: $ => seq(
      'try', $.block, repeat1($.catch_clause),
    ),

    catch_clause: $ => seq(
      'catch', '(', $._decl_type, $.identifier, ')', $.block,
    ),

    defer_statement: $ => seq('defer', $.block),

    return_statement: $ => seq('return', optional($._expression), ';'),
    yield_statement: $ => seq('yield', $._expression, ';'),
    throw_statement: $ => seq('throw', $._expression, ';'),
    break_statement: $ => seq('break', ';'),
    continue_statement: $ => seq('continue', ';'),
    goto_statement: $ => seq('goto', $.identifier, ';'),
    label_statement: $ => prec(-1, seq($.identifier, ':', $._statement)),

    expression_statement: $ => seq($._expression, ';'),

    // -----------------------------------------------------------------------
    // Expressions
    // -----------------------------------------------------------------------
    _expression: $ => choice(
      $.assignment_expression,
      $.ternary_expression,
      $.binary_expression,
      $.unary_expression,
      $.postfix_expression,
      $.cast_expression,
      $.new_expression,
      $.delete_expression,
      $.sizeof_expression,
      $.offsetof_expression,
      $.static_assert_expression,
      $.match_expression,
      $.call_expression,
      $.member_expression,
      $.pointer_member_expression,
      $.index_expression,
      $.lambda_bracket,
      $.lambda_arrow,
      $.function_reference,
      $.fstring_literal,
      $.string_literal,
      $.char_literal,
      $.number_literal,
      $.bool_literal,
      $.null_literal,
      $.this_expression,
      $.identifier_expression,
      $.qualified_name_expression,
      $.designated_initializer_list,
      $.array_literal,
      $.intrinsic_expression,
      $.parenthesized_expression,
    ),

    assignment_expression: $ => prec.right(1, seq(
      $._expression,
      choice('=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='),
      $._expression,
    )),

    ternary_expression: $ => prec.right(2, seq(
      $._expression, '?', $._expression, ':', $._expression,
    )),

    binary_expression: $ => choice(
      prec.left(3,  seq($._expression, '||', $._expression)),
      prec.left(4,  seq($._expression, '&&', $._expression)),
      prec.left(5,  seq($._expression, '|',  $._expression)),
      prec.left(6,  seq($._expression, '^',  $._expression)),
      prec.left(7,  seq($._expression, '&',  $._expression)),
      prec.left(8,  seq($._expression, choice('==', '!='), $._expression)),
      prec.left(9,  seq($._expression, choice('<', '>', '<=', '>='), $._expression)),
      prec.left(10, seq($._expression, choice('<<', '>>'), $._expression)),
      prec.left(11, seq($._expression, choice('+', '-'), $._expression)),
      prec.left(12, seq($._expression, choice('*', '/', '%'), $._expression)),
    ),

    unary_expression: $ => prec.right(13, seq(
      choice('!', '-', '+', '~', '++', '--', '&', '*'),
      $._expression,
    )),

    postfix_expression: $ => prec.left(16, seq(
      $._expression, choice('++', '--'),
    )),

    cast_expression: $ => prec(14, choice(
      seq('cast',             '<', $._decl_type, '>', '(', $._expression, ')'),
      seq('static_cast',     '<', $._decl_type, '>', '(', $._expression, ')'),
      seq('reinterpret_cast','<', $._decl_type, '>', '(', $._expression, ')'),
      seq('const_cast',      '<', $._decl_type, '>', '(', $._expression, ')'),
    )),

    new_expression: $ => prec.right(14, seq(
      'new', $._decl_type,
      optional(seq('(', commaSep($._expression), ')')),
    )),

    delete_expression: $ => prec(14, seq('delete', $._expression)),

    sizeof_expression: $ => prec(14, seq(
      'sizeof', '(', choice($._decl_type, $._expression), ')',
    )),

    offsetof_expression: $ => prec(14, seq(
      'offsetof', '(', $._decl_type, ',', $.identifier, ')',
    )),

    static_assert_expression: $ => seq(
      'static_assert', '(',
      $._expression,
      optional(seq(',', $.string_literal)),
      ')',
    ),

    // match (expr) { pat => expr, ... }
    match_expression: $ => seq(
      'match', '(', $._expression, ')',
      '{', commaSep1($.match_arm), optional(','), '}',
    ),

    match_arm: $ => seq($._match_pattern, '=>', $._expression),

    _match_pattern: $ => choice($.wildcard_pattern, $._expression),

    wildcard_pattern: $ => '_',

    call_expression: $ => prec.left(15, seq(
      $._expression, '(', commaSep($._expression), ')',
    )),

    member_expression: $ => prec.left(16, seq(
      $._expression, '.', $.identifier,
    )),

    pointer_member_expression: $ => prec.left(16, seq(
      $._expression, '->', $.identifier,
    )),

    index_expression: $ => prec.left(16, seq(
      $._expression, '[', $._expression, ']',
    )),

    parenthesized_expression: $ => seq('(', $._expression, ')'),

    // -----------------------------------------------------------------------
    // Lambda forms
    // -----------------------------------------------------------------------
    // Bracket form: [captures](params) -> RetType { body }
    lambda_bracket: $ => prec(1, seq(
      '[', optional($.capture_list), ']',
      $.parameter_list,
      optional(seq('->', $._decl_type)),
      $.block,
    )),

    capture_list: $ => commaSep1($.capture_item),
    capture_item: $ => choice(
      seq('&', $.identifier),
      $.identifier,
      '=',
      '&',
    ),

    // Arrow form: (params) => expr
    lambda_arrow: $ => prec.right(0, seq(
      $.parameter_list, '=>', $._expression,
    )),

    // -----------------------------------------------------------------------
    // Function reference  @name
    // -----------------------------------------------------------------------
    function_reference: $ => seq('@', $.identifier),

    // -----------------------------------------------------------------------
    // Intrinsics
    // -----------------------------------------------------------------------
    intrinsic_expression: $ => choice(
      '__va_count',
      seq('__va_arg', '(', $._expression, ')'),
      seq('__asm_rdtsc', '(', ')'),
      seq('__asm_pause', '(', ')'),
    ),

    // -----------------------------------------------------------------------
    // Designated initializer  { .x = 1, .y = 2 }
    // -----------------------------------------------------------------------
    designated_initializer_list: $ => prec(1, seq(
      '{', commaSep1($.designated_initializer), optional(','), '}',
    )),

    designated_initializer: $ => seq('.', $.identifier, '=', $._expression),

    // -----------------------------------------------------------------------
    // Array / aggregate literal  { expr, ... }
    // -----------------------------------------------------------------------
    array_literal: $ => seq(
      '{', commaSep($._expression), optional(','), '}',
    ),

    // -----------------------------------------------------------------------
    // Identifiers
    // -----------------------------------------------------------------------
    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,
    identifier_expression: $ => $.identifier,

    qualified_name_expression: $ => prec(1, seq(
      $.identifier, repeat1(seq('::', $.identifier)),
    )),

    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    // type_name: unified type rule used in all contexts.
    type_name: $ => prec.right(choice(
      $._primitive_type,
      $.generic_type,
      $.pointer_type,
      $.qualified_type,
      $.identifier,
    )),

    // _decl_type: alias of type_name, kept for readability in declaration rules.
    _decl_type: $ => $.type_name,

    _primitive_type: $ => choice(
      'int8', 'int16', 'int32', 'int64',
      'uint8', 'uint16', 'uint32', 'uint64',
      'aint8', 'aint16', 'aint32', 'aint64',
      'float32', 'float64', 'float', 'double',
      'bool', 'void', 'char', 'wchar',
      'string', 'wstring', 'size_t',
      'auto', 'decltype',
    ),

    // generic_type uses raw '<' — GLR handles ambiguity with binary_expression.
    // _generic_type_arg intentionally excludes bare identifier so that keyword
    // literals (true/false/null) cannot be mistaken for type arguments.
    generic_type: $ => prec(1, seq(
      $.identifier, '<', commaSep1($._generic_type_arg), '>',
    )),

    // _generic_type_arg: deliberately excludes bare $.identifier so that
    // user-defined type names (which also match identifier) cannot trigger
    // the generic_type branch when the '<' is actually a comparison operator
    // (e.g. `sound < false`). Only primitive types, nested generics, pointer
    // types and qualified names are allowed as type arguments.
    _generic_type_arg: $ => choice(
      $._primitive_type,
      $.generic_type,
      $.pointer_type,
      $.qualified_type,
    ),

    pointer_type: $ => prec.right(1, seq($.type_name, '*')),

    qualified_type: $ => prec(1, seq(
      $.identifier, repeat1(seq('::', $.identifier)),
    )),

    // -----------------------------------------------------------------------
    // Literals
    // -----------------------------------------------------------------------

    // §A2 f-string boundary contract — tokens emitted by external scanner
    fstring_literal: $ => seq(
      $.fstring_start,
      repeat(choice(
        $.fstring_text,
        seq($.fstring_expr_open, $._expression, $.fstring_expr_close),
      )),
      $.fstring_end,
    ),

    string_literal: $ => token(seq('"', /([^"\\]|\\.)*/, '"')),

    char_literal: $ => token(seq("'", /([^'\\]|\\.)/, "'")),

    number_literal: $ => token(choice(
      /0[xX][0-9a-fA-F]+/,
      // Float with optional UDL suffix (e.g. 1.5f_meter)
      /[0-9]+\.[0-9]*([eE][+-]?[0-9]+)?f?(_[a-zA-Z][a-zA-Z0-9_]*)?/,
      /[0-9]+[eE][+-]?[0-9]+f?(_[a-zA-Z][a-zA-Z0-9_]*)?/,
      // Integer UDL (e.g. 42_km)
      /[0-9]+_[a-zA-Z][a-zA-Z0-9_]*/,
      // Plain float with f suffix
      /[0-9]+f/,
      // Plain integer
      /[0-9]+/,
    )),

    bool_literal: $ => choice('true', 'false'),
    null_literal: $ => choice('null', 'nullptr'),
    this_expression: $ => 'this',
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function commaSep(rule) {
  return optional(commaSep1(rule));
}

function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}
