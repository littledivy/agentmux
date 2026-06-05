// A workspace's pane layout is a binary split tree. Leaves are terminals
// (each backed by its own tmux session) or browser panes. Splits arrange two
// children in a row (vertical divider) or column (horizontal divider).

export type Dir = "row" | "col";

export interface Leaf {
  type: "leaf";
  id: string;
  /** tmux session name backing this terminal pane. */
  term: string;
}

export interface Split {
  type: "split";
  id: string;
  dir: Dir;
  /** fraction [0..1] of space given to child `a`. */
  ratio: number;
  a: Node;
  b: Node;
}

export type Node = Leaf | Split;

let counter = 0;
const uid = (p: string) => `${p}${++counter}`;

export function termLeaf(term: string): Leaf {
  return { type: "leaf", id: uid("p"), term };
}

export function firstLeaf(n: Node): Leaf {
  return n.type === "leaf" ? n : firstLeaf(n.a);
}

export function leaves(n: Node): Leaf[] {
  return n.type === "leaf" ? [n] : [...leaves(n.a), ...leaves(n.b)];
}

// Replace leaf `targetId` with a split of [target, add].
export function splitLeaf(
  root: Node,
  targetId: string,
  dir: Dir,
  add: Leaf,
): Node {
  if (root.type === "leaf") {
    if (root.id !== targetId) return root;
    return { type: "split", id: uid("s"), dir, ratio: 0.5, a: root, b: add };
  }
  return {
    ...root,
    a: splitLeaf(root.a, targetId, dir, add),
    b: splitLeaf(root.b, targetId, dir, add),
  };
}

// Remove leaf `targetId`, collapsing its split (sibling promoted). null if the
// tree becomes empty.
export function removeLeaf(root: Node, targetId: string): Node | null {
  if (root.type === "leaf") return root.id === targetId ? null : root;
  const a = removeLeaf(root.a, targetId);
  const b = removeLeaf(root.b, targetId);
  if (a === null) return b;
  if (b === null) return a;
  return { ...root, a, b };
}

export function setRatio(root: Node, splitId: string, ratio: number): Node {
  if (root.type === "leaf") return root;
  if (root.id === splitId) {
    return { ...root, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
  }
  return {
    ...root,
    a: setRatio(root.a, splitId, ratio),
    b: setRatio(root.b, splitId, ratio),
  };
}
