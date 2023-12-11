@group(0) @binding(0) var<uniform> grid: vec2f;
@group(0) @binding(1) var<uniform> colors: array<vec4f, 4>;
@group(0) @binding(2) var<storage> states: array<u32>;

struct VertexInput {
    @location(0) position: vec2f,
    @builtin(instance_index) instanceIndex: u32,

}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) cell: vec2f
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput
{
    let i = f32(input.instanceIndex);
    let cell = vec2f(i % grid.x, floor(i / grid.x));
    let cellOffset = cell / grid * 2;
    let state = f32(states[input.instanceIndex]);
    let gridPos = (input.position*state + 1) / grid - 1 + cellOffset;

    var output: VertexOutput;
    output.position = vec4(gridPos, 0, 1);
    output.cell = cell;
    return output;
}


struct FragInput {
  @location(0) cell: vec2f,
};

@fragment
fn fragmentMain(input: FragInput) -> @location(0) vec4f {
    let factor = input.cell / grid;

    let left = colors[0] * (1 - factor.x) + colors[1] * factor.x;
    let right = colors[2] * (1 - factor.x) + colors[3] * factor.x;

    return left * (1 - factor.y) + right * factor.y;
}