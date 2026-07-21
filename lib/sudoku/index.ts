// Engine public API — see CONTRACTS.md "engine".
export { generatePuzzle } from "./generator";
export {
  solve,
  isValidPlacement,
  getConflicts,
  getCompletedUnits,
  isComplete,
} from "./solver";
