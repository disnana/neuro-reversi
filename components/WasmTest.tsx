import React, { useEffect, useState } from 'react';
import init, { Bitboard } from 'neuroreversi-engine';

const WasmTest: React.FC = () => {
    const [counts, setCounts] = useState<number[] | null>(null);
    const [validMoves, setValidMoves] = useState<number[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [bitboard, setBitboard] = useState<Bitboard | null>(null);

    useEffect(() => {
        // Explicitly point to the public file we copied
        init('/neuroreversi_engine_bg.wasm').then(() => {
            try {
                const bb = new Bitboard();
                setBitboard(bb);
                // Returns Uint32Array, convert to array
                const result = Array.from(bb.count_disks());
                setCounts(result);
            } catch (e: any) {
                setError(e.toString());
            }
        }).catch(e => {
            console.error("WASM Init failed:", e);
            setError("Failed to load WASM module");
        });
    }, []);

    const testMoveGen = () => {
        if (!bitboard) return;
        try {
            // Test Valid Moves for Black (should be 4 at start: f5, d3, c4, e6 -> indices 37, 20, 26, 44 ... roughly)
            // Indices:
            // d3 (row 2, col 3) -> 19
            // c4 (row 3, col 2) -> 26
            // f5 (row 4, col 5) -> 37
            // e6 (row 5, col 4) -> 44
            const moves = bitboard.get_valid_moves_indices(true);
            setValidMoves(Array.from(moves));
        } catch (e: any) {
            setError("Move Logic Error: " + e.toString());
        }
    };

    return (
        <div className="p-4 bg-gray-800 text-white rounded-lg mt-4 border border-cyan-500/30">
            <h3 className="text-xl font-bold mb-2 text-cyan-400">NeuroReversi v3 Core (Rust/WASM)</h3>
            {error ? (
                <div className="text-red-400">Error: {error}</div>
            ) : counts ? (
                <div>
                    <p>Bitboard Initialized Successfully.</p>
                    <div className="flex gap-4 mt-2">
                        <span className="px-3 py-1 bg-black rounded">Black Bits: {counts[0]} (Expected 2)</span>
                        <span className="px-3 py-1 bg-white text-black rounded">White Bits: {counts[1]} (Expected 2)</span>
                    </div>

                    <div className="mt-4 border-t border-gray-700 pt-3">
                        <button
                            onClick={testMoveGen}
                            className="px-3 py-1 bg-cyan-700 hover:bg-cyan-600 rounded text-xs font-bold transition-colors"
                        >
                            TEST MOVE GEN (RUST)
                        </button>
                        <button
                            onClick={() => {
                                if (bitboard) {
                                    // Test Depth 4 search
                                    const start = performance.now();
                                    // Pass dummy weights (all zeros) for testing
                                    const dummyWeights = new Int32Array(64);
                                    const moveIdx = bitboard.get_best_move(6, true, dummyWeights);
                                    const end = performance.now();
                                    alert(`Best Move Index: ${moveIdx} (Calculated in ${(end - start).toFixed(2)}ms at Depth 6)`);
                                }
                            }}
                            className="ml-2 px-3 py-1 bg-purple-700 hover:bg-purple-600 rounded text-xs font-bold transition-colors"
                        >
                            TEST AI (Depth 6)
                        </button>
                        {validMoves && (
                            <div className="mt-2 text-sm text-green-400">
                                Valid Moves Found: {validMoves.length}
                                <br />
                                Indices: {validMoves.join(', ')}
                            </div>
                        )}
                    </div>

                    <p className="text-xs text-gray-400 mt-2">Core engine running via WebAssembly</p>
                </div>
            ) : (
                <div>Initializing WASM Engine...</div>
            )}
        </div>
    );
};

export default WasmTest;
