// Perception value-type registry (angel-lsp-pcx parity).
//
// Host docs (2026-07-28) mark these as value / RAII wrappers — not reference
// classes. The analyzer uses this set for move-only / handle diagnostics and
// future `@` / pointer-on-value warnings.
//
// Sources:
//   https://docs.perception.cx/perception/proc-api.md
//   https://docs.perception.cx/perception/sound-api.md
//   https://docs.perception.cx/perception/unicorn-api.md
//   https://docs.perception.cx/perception/gui-api.md
//   https://docs.perception.cx/perception/net-api.md
//   https://docs.perception.cx/perception/zydis-api.md
//   https://docs.perception.cx/perception/win-api.md
//   https://docs.perception.cx/perception/enma-lang/addons/math-3d.md

/** Pure value math types (deep-copy; no host ref). */
export const PERCEPTION_MATH_VALUE_TYPES: ReadonlySet<string> = new Set([
    'vec2',
    'vec3',
    'vec4',
    'quat',
    'mat4',
    'color',
]);

/**
 * Host handle wrappers that behave as values (RAII / move-only where noted).
 * Calling code should not invent `deref()` on modern `proc_t`.
 */
export const PERCEPTION_HANDLE_VALUE_TYPES: ReadonlySet<string> = new Set([
    // proc
    'proc_t',
    'module_info_t',
    'vad_region_t',
    // sound
    'sound_t',
    'sound_inst_t',
    // unicorn
    'cpu_t',
    // net
    'http_response_t',
    'ws_t',
    'ws_message_t',
    'udp_t',
    // zydis
    'zydis_req_t',
    'zydis_builder_t',
    // win
    'window_info_t',
    // gui (engine-owned handles; dtor noop, unload sweep)
    'sidebar_section_t',
    'label_t',
    'button_t',
    'checkbox_t',
    'slider_t',
    'slider_icon_t',
    'value_input_t',
    'options_t',
    'multi_options_t',
    'dropdown_t',
    'multi_dropdown_t',
    'list_t',
    'inline_button_t',
    'inline_text_input_t',
    'tabs_t',
    'keybind_t',
    'progress_bar_t',
    'spinner_t',
    'range_slider_t',
    'table_t',
    'text_input_t',
    'text_editor_t',
    'colorpicker_t',
    'layer_t',
    'frame_t',
    'widget_t',
    'menu_t',
    'file_picker_t',
    'key_state_t',
]);

/** Move-only RAII host types (destructor releases a host ref exactly once). */
export const PERCEPTION_MOVE_ONLY_TYPES: ReadonlySet<string> = new Set([
    'proc_t',
    'sound_t',
    'sound_inst_t',
    'cpu_t',
]);

export function isPerceptionValueType(name: string): boolean {
    return PERCEPTION_MATH_VALUE_TYPES.has(name) || PERCEPTION_HANDLE_VALUE_TYPES.has(name);
}

export function isPerceptionMoveOnlyType(name: string): boolean {
    return PERCEPTION_MOVE_ONLY_TYPES.has(name);
}
