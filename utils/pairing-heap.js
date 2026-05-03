"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PairingHeap = void 0;
// minimal pairing heap priority queue implementation
class PairingHeap {
    root = null;
    comparator;
    // comparator function should return 'true' if a is higher priority than b
    constructor(comparator) {
        this.comparator = comparator;
    }
    isEmpty() {
        return !this.root;
    }
    add(element) {
        const node = {
            element
        };
        this.root = this.meld(this.root, node);
        return node;
    }
    // returns the top priority element without modifying the queue
    peek() {
        return this.root?.element;
    }
    // removes and returns the top priority element
    pop() {
        let element;
        if (this.root) {
            const node = this.root;
            element = node.element;
            this.root = this.mergePairs(node.child);
        }
        return element;
    }
    deleteNode(node) {
        if (!node) {
            return;
        }
        if (node === this.root) {
            this.root = this.mergePairs(node.child);
        }
        else {
            if (node.prev) {
                if (node.prev.child === node) {
                    node.prev.child = node.next;
                }
                else {
                    node.prev.next = node.next;
                }
            }
            if (node.next) {
                node.next.prev = node.prev;
            }
            this.root = this.meld(this.root, this.mergePairs(node.child));
        }
        node.child = null;
        node.prev = null;
        node.next = null;
    }
    // fix the heap after increasing the priority of a given node
    increasePriority(node) {
        // already the top priority element
        if (!node || node === this.root) {
            return;
        }
        // extract from siblings
        if (node.prev) {
            if (node.prev?.child === node) {
                if (this.comparator(node.prev.element, node.element)) {
                    // already in a valid position
                    return;
                }
                node.prev.child = node.next;
            }
            else {
                node.prev.next = node.next;
            }
        }
        if (node.next) {
            node.next.prev = node.prev;
        }
        this.root = this.meld(this.root, node);
    }
    decreasePriority(node) {
        this.deleteNode(node);
        this.root = this.meld(this.root, node);
    }
    meld(a, b) {
        if (!a) {
            return b;
        }
        if (!b || a === b) {
            return a;
        }
        let parent = b;
        let child = a;
        if (this.comparator(a.element, b.element)) {
            parent = a;
            child = b;
        }
        child.next = parent.child;
        if (parent.child) {
            parent.child.prev = child;
        }
        child.prev = parent;
        parent.child = child;
        parent.next = null;
        parent.prev = null;
        return parent;
    }
    mergePairs(node) {
        if (!node) {
            return null;
        }
        let current = node;
        let next;
        let nextCurrent;
        let pairs;
        let melded;
        while (current) {
            next = current.next;
            if (next) {
                nextCurrent = next.next;
                melded = this.meld(current, next);
                if (melded) {
                    melded.prev = pairs;
                }
                pairs = melded;
            }
            else {
                nextCurrent = null;
                current.prev = pairs;
                pairs = current;
                break;
            }
            current = nextCurrent;
        }
        melded = null;
        let prev;
        while (pairs) {
            prev = pairs.prev;
            melded = this.meld(melded, pairs);
            pairs = prev;
        }
        return melded;
    }
}
exports.PairingHeap = PairingHeap;
