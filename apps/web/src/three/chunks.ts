import * as THREE from 'three';
import type { Vec } from '@fansong/engine';

/**
 * Static board geometry, merged into one mesh per square block of cells.
 * Hundreds of hexes as separate meshes cost a draw call each (thousands on a
 * big map, with its features); merged into blocks they cost a few dozen, and
 * each block is still culled off screen and skipped by picking. Every vertex
 * carries its piece's colour, and each mesh keeps, per triangle, the cell it
 * belongs to in `userData.cells`.
 */
export class BoardChunks {
  private readonly chunks = new Map<string, Chunk>();
  private readonly color = new THREE.Color();
  private readonly normalMatrix = new THREE.Matrix3();
  private readonly v = new THREE.Vector3();

  /** `size` is the cells per side of a block. */
  constructor(private readonly size: number) {}

  /** One triangle of `cell`, wound counter-clockwise seen from its front, with a flat normal. */
  triangle(cell: Vec, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, normal: THREE.Vector3, color: number): void {
    const chunk = this.chunkOf(cell);
    this.color.setHex(color);
    for (const p of [a, b, c]) {
      chunk.positions.push(p.x, p.y, p.z);
      chunk.normals.push(normal.x, normal.y, normal.z);
      chunk.colors.push(this.color.r, this.color.g, this.color.b);
    }
    chunk.cells.push(cell);
  }

  /** A non-indexed geometry (every three vertices a triangle), placed by `matrix`. */
  geometry(cell: Vec, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number): void {
    const chunk = this.chunkOf(cell);
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    this.normalMatrix.getNormalMatrix(matrix);
    this.color.setHex(color);
    for (let i = 0; i < pos.count; i++) {
      this.v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      chunk.positions.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(nor, i).applyMatrix3(this.normalMatrix).normalize();
      chunk.normals.push(this.v.x, this.v.y, this.v.z);
      chunk.colors.push(this.color.r, this.color.g, this.color.b);
    }
    for (let t = 0; t < pos.count / 3; t++) chunk.cells.push(cell);
  }

  /** One mesh per block, all sharing `material`. */
  meshes(material: THREE.Material): THREE.Mesh[] {
    return [...this.chunks.values()].map((chunk) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunk.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(chunk.normals, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(chunk.colors, 3));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.matrixAutoUpdate = false; // never moves
      mesh.userData.cells = chunk.cells;
      return mesh;
    });
  }

  private chunkOf(cell: Vec): Chunk {
    const key = `${Math.floor(cell.x / this.size)},${Math.floor(cell.y / this.size)}`;
    let chunk = this.chunks.get(key);
    if (!chunk) this.chunks.set(key, (chunk = { positions: [], normals: [], colors: [], cells: [] }));
    return chunk;
  }
}

interface Chunk {
  positions: number[];
  normals: number[];
  colors: number[];
  cells: Vec[];
}
