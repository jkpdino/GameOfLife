import cellSource from './cell.wgsl?raw'
import simulationSource from './simulate.wgsl?raw'

const { abs, min, max, round } = Math;

/**
 * Converts an HSL color value to RGB. Conversion formula
 * adapted from https://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes h, s, and l are contained in the set [0, 1] and
 * returns r, g, and b in the set [0, 255].
 *
 * @param   {number}  h       The hue
 * @param   {number}  s       The saturation
 * @param   {number}  l       The lightness
 * @return  {Array}           The RGB representation
 */
function hslToRgb(h, s, l) {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1/3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1/3);
  }

  return [r, g, b];
}

function hueToRgb(p, q, t) {
	if (t < 0) t += 1;
	if (t > 1) t -= 1;
	if (t < 1/6) return p + (q - p) * 6 * t;
	if (t < 1/2) return q;
	if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
	return p;
  }

class GameOfLife {
	canvas: HTMLCanvasElement;
	adapter: GPUAdapter;
	device: GPUDevice;
	context: GPUCanvasContext;

	vertexBuffer: GPUBuffer;
	uniformBuffer: GPUBuffer;
	colorBuffer: GPUBuffer;

	cellPipeline: GPURenderPipeline;
	simulatePipeline: GPUComputePipeline;

	bindGroups: Array<GPUBindGroup>;

	grid_size: number;

	cell_storage_buffer: Array<GPUBuffer>;


	time: number;
	step: number;

	disco_speed: number;
	sim_speed: number;
	

	constructor(grid_size: number, disco_speed: number, sim_speed: number) {
		this.grid_size = grid_size;
		this.time = 0;
		this.step = 0;

		this.disco_speed = disco_speed;
		this.sim_speed = sim_speed;
	}

	async setup() {
		const canvas = document.querySelector("canvas")!;

		// WebGPU device initialization
		if (!navigator.gpu) {
			throw new Error("WebGPU not supported on this browser.");
		}

		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			throw new Error("No appropriate GPUAdapter found.");
		}

		const device = await adapter.requestDevice();

		// Create a buffer with the vertices for a single cell.
		// Canvas configuration
		const context = canvas.getContext("webgpu")!;
		const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
		context.configure({
			device: device,
			format: canvasFormat,
		});

		// Create a buffer with the vertices for a single cell.
		const vertices = new Float32Array([
			//   X,    Y
			-0.8, -0.8, // Triangle 1
			0.8, -0.8,
			0.8,  0.8,

			-0.8, -0.8, // Triangle 2
			0.8,  0.8,
			-0.8,  0.8,
		]);
		const vertexBuffer = device.createBuffer({
			label: "Cell vertices",
			size: vertices.byteLength,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		});
		device.queue.writeBuffer(vertexBuffer, 0, vertices);

		// Create a uniform buffer that describes the grid.
		const uniformArray = new Float32Array([this.grid_size, this.grid_size]);
		const uniformBuffer = device.createBuffer({
			label: "Grid Uniforms",
			size: uniformArray.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

		const colorBuffer = device.createBuffer({
			label: "Grid Uniforms",
			size: 4 * 4 * 4,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		// Create an array representing the active state of each cell.
		const cellStateArray = new Uint32Array(this.grid_size * this.grid_size);

		// Set this up

		// Create a storage buffer to hold the cell state.
		const cellStateStorage = [
			device.createBuffer({
				label: "Cell State 1",
				size: cellStateArray.byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			}),
			device.createBuffer({
				label: "Cell State 2",
				size: cellStateArray.byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			}),
		];

		for (let i = 0; i < cellStateArray.length; ++i) {
			cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
		  }
		device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);
		device.queue.writeBuffer(cellStateStorage[1], 0, cellStateArray);

		const vertexBufferLayout = {
			arrayStride: 8,
			attributes: [{
				format: "float32x2",
				offset: 0,
				shaderLocation: 0, // Position. Matches @location(0) in the @vertex shader.
			}],
		};

		// Create the shader that will render the cells.
		const cellShaderModule = device.createShaderModule({
			label: "Cell shader",
			code: cellSource
		});

		const simulationShaderModule = device.createShaderModule({
			label: "Simulation shader",
			code: simulationSource
		});

		let bindGroupLayout = device.createBindGroupLayout({
			label: "Cell Bind Group Layout",
				entries: [{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
					buffer: {} // Grid uniform buffer
				}, {
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: {} // Color buffer
				}, {
					binding: 2,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
					buffer: { type: "read-only-storage"} // Cell state input buffer
				}, {
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage"} // Cell state output buffer
				}]
		});

		const bindGroups = 
		[
			device.createBindGroup({
				label: "Cell renderer bind group",
				layout: bindGroupLayout,
				entries: [{
					binding: 0,
					resource: { buffer: uniformBuffer }
				},
				{
					binding: 1,
					resource: { buffer: colorBuffer }
				},
				{
					binding: 2,
					resource: { buffer: cellStateStorage[0] }
				},
				{
					binding: 3,
					resource: { buffer: cellStateStorage[1] }
				}],
			}),

			device.createBindGroup({
				label: "Cell renderer bind group",
				layout: bindGroupLayout,
				entries: [{
					binding: 0,
					resource: { buffer: uniformBuffer }
				},
				{
					binding: 1,
					resource: { buffer: colorBuffer }
				},
				{
					binding: 2,
					resource: { buffer: cellStateStorage[1] }
				},
				{
					binding: 3,
					resource: { buffer: cellStateStorage[0] }
				}],
			}),
		]

		const pipelineLayout = device.createPipelineLayout({
			label: "Compute Pipeline Layout",
			bindGroupLayouts: [bindGroupLayout]
		});

		// Create a pipeline that renders the cell.
		const cellPipeline = device.createRenderPipeline({
			label: "Cell pipeline",
			layout: pipelineLayout,
			vertex: {
				module: cellShaderModule,
				entryPoint: "vertexMain",
				buffers: [vertexBufferLayout]
			},
			fragment: {
				module: cellShaderModule,
				entryPoint: "fragmentMain",
				targets: [{
				format: canvasFormat
				}]
			}
		});

		const simulationPipeline = device.createComputePipeline({
			label: "Simulation pipeline",
			layout: pipelineLayout,
			compute: {
			  module: simulationShaderModule,
			  entryPoint: "simulate",
			}
		  });

		this.adapter = adapter;
		this.device = device;
		this.context = context;
		this.canvas = canvas;
		this.vertexBuffer = vertexBuffer;
		this.uniformBuffer = uniformBuffer
		this.colorBuffer = colorBuffer;
		this.vertexBuffer = vertexBuffer;
		this.cellPipeline = cellPipeline;
		this.simulatePipeline = simulationPipeline;
		this.bindGroups = bindGroups;
		this.cell_storage_buffer = cellStateStorage;
	}

	async tick() {
		let delta = 1/60;

		this.time += delta;
		this.step += delta * this.sim_speed;
	}

	async render() {
		let offset = (this.time % (1/ this.disco_speed)) * this.disco_speed;

		let color1 = hslToRgb(offset + 0.2, 0.5, 0.5);
		let color2 = hslToRgb(offset + 0.4, 0.5, 0.5);
		let color3 = hslToRgb(offset + 0.6, 0.5, 0.5);
		let color4 = hslToRgb(offset + 0.8, 0.5, 0.5);

		// Update the color buffer

		this.device.queue.writeBuffer(this.colorBuffer, 0, new Float32Array([
			color1[0], color1[1], color1[2], 1,
			color2[0], color2[1], color2[2], 1,
			color3[0], color3[1], color3[2], 1,
			color4[0], color4[1], color4[2], 1
		]));

		// Clear the canvas with a render pass
		const encoder = this.device.createCommandEncoder();

		const pass = encoder.beginRenderPass({
			colorAttachments: [{
				view: this.context.getCurrentTexture().createView(),
				loadOp: "clear",
				clearValue: { r: 0, g: 0, b: 0.4, a: 1.0 },
				storeOp: "store",
			}]
		});

		let bindGroup = this.bindGroups[Math.floor(this.step % 2)];

		// Draw the square.
		pass.setPipeline(this.cellPipeline);
		pass.setVertexBuffer(0, this.vertexBuffer);
		pass.setBindGroup(0, bindGroup);
		pass.draw(6, this.grid_size * this.grid_size * 2);

		pass.end();

		const computePass = encoder.beginComputePass();

		computePass.setPipeline(this.simulatePipeline);
		computePass.setBindGroup(0, bindGroup);

		computePass.dispatchWorkgroups(this.grid_size / 8, this.grid_size / 8, 1);

		computePass.end();

		this.device.queue.submit([encoder.finish()]);
	}
}

async function main() {
	const game = new GameOfLife(256, 0.5, 60);

	await game.setup();
	
	setInterval(async () => {
		await game.tick();
		await game.render();
	}, 1000 / 60)
}

main()