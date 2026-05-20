; ── Comments ─────────────────────────────────────────────
(comment) @comment

; ── Preprocessor ────────────────────────────────────────
(preprocessor
  "#" @punctuation.special
  directive: (identifier) @keyword.directive)

; ── Strings ─────────────────────────────────────────────
(string) @string
(string (escape) @string.escape)
(f_string) @string
(f_string (escape) @string.escape)
(interpolation) @string.special
(char_literal) @string.character
(char_literal (escape) @string.escape)

; ── Numbers ─────────────────────────────────────────────
(number) @number

; ── Identifiers ─────────────────────────────────────────
(identifier) @variable

; ── Keywords (anonymous tokens — matched by literal) ────
; Control flow
"if" @keyword.control
"else" @keyword.control
"for" @keyword.control
"while" @keyword.control
"do" @keyword.control
"switch" @keyword.control
"match" @keyword.control
"case" @keyword.control
"default" @keyword.control
"break" @keyword.control
"continue" @keyword.control
"return" @keyword.control
"goto" @keyword.control
"try" @keyword.control
"catch" @keyword.control
"throw" @keyword.control
"defer" @keyword.control
"yield" @keyword.control

; Declaration keywords
"class" @keyword.type
"struct" @keyword.type
"interface" @keyword.type
"enum" @keyword.type
"namespace" @keyword.type
"template" @keyword.type
"typedef" @keyword.type
"mixin" @keyword.type
"import" @keyword.type
"extern" @keyword.type
"delegate" @keyword.type
"property" @keyword.type
"coroutine" @keyword.type
"typename" @keyword.type
"operator" @keyword.operator
"function" @keyword.type
"using" @keyword.type

; Storage modifiers
"static" @keyword.modifier
"const" @keyword.modifier
"constexpr" @keyword.modifier
"override" @keyword.modifier
"public" @keyword.modifier
"private" @keyword.modifier
"protected" @keyword.modifier
"virtual" @keyword.modifier
"abstract" @keyword.modifier
"final" @keyword.modifier
"shared" @keyword.modifier
"inline" @keyword.modifier
"nullable" @keyword.modifier
"out" @keyword.modifier
"auto" @keyword.modifier
"volatile" @keyword.modifier
"get" @keyword.modifier
"set" @keyword.modifier

; Expression keywords
"new" @keyword.operator
"delete" @keyword.operator
"sizeof" @keyword.operator
"typeof" @keyword.operator
"cast" @keyword.operator
"static_cast" @keyword.operator
"reinterpret_cast" @keyword.operator
"const_cast" @keyword.operator

; Constants
"true" @constant.builtin
"false" @constant.builtin
"null" @constant.builtin
"nullptr" @constant.builtin
"this" @variable.builtin

; Primitive types
"int8" @type.builtin
"int16" @type.builtin
"int32" @type.builtin
"int64" @type.builtin
"uint8" @type.builtin
"uint16" @type.builtin
"uint32" @type.builtin
"uint64" @type.builtin
"aint8" @type.builtin
"aint16" @type.builtin
"aint32" @type.builtin
"aint64" @type.builtin
"float32" @type.builtin
"float64" @type.builtin
"float" @type.builtin
"double" @type.builtin
"string" @type.builtin
"wstring" @type.builtin
"char" @type.builtin
"wchar" @type.builtin
"bool" @type.builtin
"void" @type.builtin
"size_t" @type.builtin

; Builtin types
"array" @type.builtin
"map" @type.builtin
"hash_set" @type.builtin
"sorted_map" @type.builtin
"variant" @type.builtin
"vec2" @type.builtin
"vec3" @type.builtin
"vec4" @type.builtin
"coroutine_t" @type.builtin
"atomic_int32" @type.builtin
"atomic_int64" @type.builtin
"mutex" @type.builtin
"cond_var" @type.builtin
"lock_guard" @type.builtin
"file_t" @type.builtin
"regex" @type.builtin
"json_value" @type.builtin

; ── Punctuation / Operators ─────────────────────────────
"=" @operator
"+=" @operator
"-=" @operator
"*=" @operator
"/=" @operator
"%=" @operator
"&=" @operator
"|=" @operator
"^=" @operator
"||" @operator
"&&" @operator
"==" @operator
"!=" @operator
"<" @operator
">" @operator
"<=" @operator
">=" @operator
"|" @operator
"^" @operator
"&" @operator
"+" @operator
"-" @operator
"*" @operator
"/" @operator
"%" @operator
"!" @operator
"~" @operator
"++" @operator
"--" @operator
"?" @operator
":" @punctuation
"::" @punctuation.special
"." @punctuation.delimiter
"->" @punctuation.delimiter
"," @punctuation.delimiter
";" @punctuation.delimiter
"..." @punctuation.special
"@" @punctuation.special

; ── Brackets ────────────────────────────────────────────
"(" @punctuation.bracket
")" @punctuation.bracket
"[" @punctuation.bracket
"]" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket
