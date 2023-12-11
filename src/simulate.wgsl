@group(0) @binding(0) var<uniform> grid: vec2f;

@group(0) @binding(2) var<storage> cellStateIn: array<u32>;
@group(0) @binding(3) var<storage, read_write> cellStateOut: array<u32>;

fn cellIndex(cell: vec2u) -> u32 {
  return (cell.y % u32(grid.y)) * u32(grid.x) +
         (cell.x % u32(grid.x));
}

fn cellState(x: u32, y: u32) -> u32 {
    return cellStateIn[cellIndex(vec2u(x, y))];
}

@compute
@workgroup_size(8, 8, 1)
fn simulate(
    @builtin(global_invocation_id) cell: vec3u,
) {
    let aliveNeighbors = cellState(cell.x + 1, cell.y) +
                         cellState(cell.x - 1, cell.y) +
                         cellState(cell.x, cell.y + 1) +
                         cellState(cell.x, cell.y - 1) +
                         cellState(cell.x + 1, cell.y + 1) +
                         cellState(cell.x - 1, cell.y - 1) +
                         cellState(cell.x + 1, cell.y - 1) +
                         cellState(cell.x - 1, cell.y + 1);

    if aliveNeighbors == 2 {
        cellStateOut[cellIndex(cell.xy)] = cellStateIn[cellIndex(cell.xy)];
    } else if aliveNeighbors == 3 {
        cellStateOut[cellIndex(cell.xy)] = 1;
    } else {
        cellStateOut[cellIndex(cell.xy)] = 0;
    }   
}