// AC-7 — pointer-vs-value member access rules.
//
// `.` requires a value receiver (pointerLevel == 0).
// `->` requires a pointer receiver (pointerLevel >= 1).
//
// Both diagnostics are R21-exempt: they stay Error even when the rollback
// severity is 'warning'. We achieve that via analyzerDiagnostic.errorForce.

import { NodeExprMemberArrow, NodeExprMemberDot } from '../compiler_parser/nodes';
import { analyzerDiagnostic } from './analyzerDiagnostic';
import { ResolvedType } from './resolvedType';

/**
 * Verify the access operator matches the receiver shape. Returns true iff
 * the access is well-formed (i.e. no diagnostic emitted).
 */
export function checkMemberDotAccess(
    node: NodeExprMemberDot,
    receiverType: ResolvedType | undefined,
): boolean {
    if (receiverType === undefined) return true; // unknown — let caller diagnose
    if (receiverType.pointerLevel > 0) {
        analyzerDiagnostic.errorForce(
            node.member.location,
            "use '->' for pointer access",
            'EN_PTR_DOT_ON_POINTER',
        );
        return false;
    }
    return true;
}

export function checkMemberArrowAccess(
    node: NodeExprMemberArrow,
    receiverType: ResolvedType | undefined,
): boolean {
    if (receiverType === undefined) return true;
    if (receiverType.pointerLevel === 0) {
        analyzerDiagnostic.errorForce(
            node.member.location,
            "use '.' for value access",
            'EN_PTR_ARROW_ON_VALUE',
        );
        return false;
    }
    return true;
}
