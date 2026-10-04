const canvas = document.getElementById("navball");
const context = canvas.getContext("2d");
const rpyCanvas = document.getElementById("rpyCanvas");
const rpyContext = rpyCanvas.getContext("2d");
const rDotCanvas = document.getElementById("rDotCanvas");
const rDotContext = rDotCanvas.getContext("2d");
const pDotCanvas = document.getElementById("pDotCanvas");
const pDotContext = pDotCanvas.getContext("2d");
const yDotCanvas = document.getElementById("yDotCanvas");
const yDotContext = yDotCanvas.getContext("2d");
const backgroundCanvas = document.getElementById("navballBackground");
const webgl = backgroundCanvas.getContext("webgl", { alpha: true, antialias: false });
const border = 2;
const canvasPadding = 34;
const labelTexture = document.createElement("canvas");
labelTexture.width = 2048;
labelTexture.height = 1024;
const labelTextureContext = labelTexture.getContext("2d");
const labelGapTexture = document.createElement("canvas");
labelGapTexture.width = labelTexture.width;
labelGapTexture.height = labelTexture.height;
const labelGapTextureContext = labelGapTexture.getContext("2d");
let labelTexturePixels = null;
let labelGapTexturePixels = null;
let labelTextureRadius = 0;
let labelTextureTargetX = Number.NaN;
let labelTextureTargetY = Number.NaN;
let labelTextureTargetZ = Number.NaN;
let renderScale = 1;
let labelTextureNeedsUpload = true;
let backgroundProgram = null;
let backgroundBuffer = null;
let backgroundTexture = null;
let backgroundUniforms = null;

let orientation = [
	[1, 0, 0],
	[0, 1, 0],
	[0, 0, 1],
];

const rotationAcceleration = {
	pitch: 0,
	roll: 0,
	yaw: 0,
};
const rotationVelocity = {
	pitch: 0,
	roll: 0,
	yaw: 0,
};

const movementAcceleration = {
	x: 0,
	y: 0,
	z: 0,
};
const movementVelocity = {
	x: 0,
	y: 0,
	z: 0,
};
const targetRelativePosition = {
	x: 200,
	y: -250,
	z: 200,
};
const movementAccelerationValue = 1;
let animationFrame = null;
let lastTimestamp = performance.now();

function isMoving() {
	return Object.values(rotationAcceleration).some((rate) => rate !== 0)
		|| Object.values(rotationVelocity).some((rate) => rate !== 0)
		|| Object.values(movementAcceleration).some((rate) => rate !== 0)
		|| Object.values(movementVelocity).some((speed) => speed !== 0);
}

function scheduleAnimation() {
	if (animationFrame === null) {
		animationFrame = requestAnimationFrame(animate);
	}
}

function initializeBackgroundRenderer() {
	if (!webgl) {
		return false;
	}
	if (backgroundProgram) {
		return true;
	}

	const vertexShader = webgl.createShader(webgl.VERTEX_SHADER);
	webgl.shaderSource(vertexShader, `
		attribute vec2 position;
		varying vec2 spherePosition;
		void main() {
			spherePosition = position;
			gl_Position = vec4(position, 0.0, 1.0);
		}
	`);
	webgl.compileShader(vertexShader);
	if (!webgl.getShaderParameter(vertexShader, webgl.COMPILE_STATUS)) {
		console.error(webgl.getShaderInfoLog(vertexShader));
		return false;
	}

	const fragmentShader = webgl.createShader(webgl.FRAGMENT_SHADER);
	webgl.shaderSource(fragmentShader, `
		precision mediump float;
		uniform mat3 inverseOrientation;
		uniform sampler2D labelTexture;
		uniform float sphereScale;
		varying vec2 spherePosition;
		void main() {
			vec2 spherePoint = spherePosition * sphereScale;
			float radiusSquared = dot(spherePoint, spherePoint);
			if (radiusSquared > 1.0) {
				gl_FragColor = vec4(0.0);
			} else {
				vec3 viewPoint = vec3(spherePoint, sqrt(max(0.0, 1.0 - radiusSquared)));
				vec3 localPoint = inverseOrientation * viewPoint;
				float latitude = asin(clamp(localPoint.x, -1.0, 1.0));
				float longitude = atan(localPoint.z, localPoint.y);
				vec2 uv = vec2(longitude / 6.2831853 + 0.5, 0.5 - latitude / 3.14159265);
				vec4 label = texture2D(labelTexture, uv);
				float absoluteLatitude = abs(localPoint.x);
				vec3 baseColor;
				if (absoluteLatitude >= 0.96592583) {
					baseColor = vec3(0.65098, 0.0, 0.0);
				} else if (absoluteLatitude < 0.0348995) {
					baseColor = localPoint.y >= 0.0
						? vec3(0.88627, 0.88627, 0.88627)
						: vec3(0.11765, 0.11765, 0.11765);
				} else if (localPoint.y >= 0.0) {
					baseColor = localPoint.x >= 0.0
						? mix(vec3(0.88627, 0.88627, 0.88627), vec3(0.616, 0.396, 0.396), 0.2)
						: mix(vec3(0.88627, 0.88627, 0.88627), vec3(0.266, 0.741, 0.827), 0.2);
				} else {
					baseColor = localPoint.x >= 0.0
						? mix(vec3(0.11765, 0.11765, 0.11765), vec3(0.424, 0.173, 0.173), 0.2)
						: mix(vec3(0.11765, 0.11765, 0.11765), vec3(0.024, 0.565, 0.663), 0.2);
				}
				gl_FragColor = vec4(mix(baseColor, label.rgb, label.a), 1.0);
			}
		}
	`);
	webgl.compileShader(fragmentShader);
	if (!webgl.getShaderParameter(fragmentShader, webgl.COMPILE_STATUS)) {
		console.error(webgl.getShaderInfoLog(fragmentShader));
		return false;
	}

	backgroundProgram = webgl.createProgram();
	webgl.attachShader(backgroundProgram, vertexShader);
	webgl.attachShader(backgroundProgram, fragmentShader);
	webgl.linkProgram(backgroundProgram);
	if (!webgl.getProgramParameter(backgroundProgram, webgl.LINK_STATUS)) {
		console.error(webgl.getProgramInfoLog(backgroundProgram));
		backgroundProgram = null;
		return false;
	}

	backgroundBuffer = webgl.createBuffer();
	webgl.bindBuffer(webgl.ARRAY_BUFFER, backgroundBuffer);
	webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), webgl.STATIC_DRAW);
	backgroundTexture = webgl.createTexture();
	webgl.bindTexture(webgl.TEXTURE_2D, backgroundTexture);
	webgl.texParameteri(webgl.TEXTURE_2D, webgl.TEXTURE_WRAP_S, webgl.REPEAT);
	webgl.texParameteri(webgl.TEXTURE_2D, webgl.TEXTURE_WRAP_T, webgl.CLAMP_TO_EDGE);
	webgl.texParameteri(webgl.TEXTURE_2D, webgl.TEXTURE_MIN_FILTER, webgl.LINEAR);
	webgl.texParameteri(webgl.TEXTURE_2D, webgl.TEXTURE_MAG_FILTER, webgl.LINEAR);
	backgroundUniforms = {
		position: webgl.getAttribLocation(backgroundProgram, "position"),
		orientation: webgl.getUniformLocation(backgroundProgram, "inverseOrientation"),
		labelTexture: webgl.getUniformLocation(backgroundProgram, "labelTexture"),
		sphereScale: webgl.getUniformLocation(backgroundProgram, "sphereScale"),
	};
	return true;
}

function drawWebGlBackground(radius) {
	if (!initializeBackgroundRenderer()) {
		return false;
	}

	webgl.viewport(0, 0, backgroundCanvas.width, backgroundCanvas.height);
	webgl.clearColor(0, 0, 0, 0);
	webgl.clear(webgl.COLOR_BUFFER_BIT);
	webgl.useProgram(backgroundProgram);
	webgl.bindBuffer(webgl.ARRAY_BUFFER, backgroundBuffer);
	webgl.enableVertexAttribArray(backgroundUniforms.position);
	webgl.vertexAttribPointer(backgroundUniforms.position, 2, webgl.FLOAT, false, 0, 0);
	webgl.uniformMatrix3fv(backgroundUniforms.orientation, false, new Float32Array([
		...orientation[0],
		...orientation[1],
		...orientation[2],
	]));
	webgl.uniform1f(
		backgroundUniforms.sphereScale,
		(Math.min(backgroundCanvas.width, backgroundCanvas.height) / 2) / radius
	);
	webgl.activeTexture(webgl.TEXTURE0);
	webgl.bindTexture(webgl.TEXTURE_2D, backgroundTexture);
	if (labelTextureNeedsUpload) {
		webgl.pixelStorei(webgl.UNPACK_FLIP_Y_WEBGL, true);
		webgl.texImage2D(webgl.TEXTURE_2D, 0, webgl.RGBA, webgl.RGBA, webgl.UNSIGNED_BYTE, labelTexture);
		labelTextureNeedsUpload = false;
	}
	webgl.uniform1i(backgroundUniforms.labelTexture, 0);
	webgl.drawArrays(webgl.TRIANGLES, 0, 3);
	return true;
}

const buttons = [
	["pitchPlus", "pitch", 1],
	["pitchMinus", "pitch", -1],
	["rollPlus", "roll", 1],
	["rollMinus", "roll", -1],
	["yawPlus", "yaw", -1],
	["yawMinus", "yaw", 1],
];

for (const [id, axis, direction] of buttons) {
	const button = document.getElementById(id);

 button.addEventListener("click", () => {
	rotationAcceleration[axis] += direction;
		lastTimestamp = performance.now();
		drawNavball();
		if (isMoving()) {
			scheduleAnimation();
		} else if (animationFrame !== null) {
			cancelAnimationFrame(animationFrame);
			animationFrame = null;
		}
 });
}

const keyboardButtons = {
	i: "pitchPlus",
	k: "pitchMinus",
	l: "yawPlus",
	j: "yawMinus",
	o: "rollPlus",
	u: "rollMinus",
};

const movementKeys = {
	w: ["y", 1],
	s: ["y", -1],
	a: ["x", -1],
	d: ["x", 1],
	q: ["z", -1],
	e: ["z", 1],
};

document.addEventListener("keydown", (event) => {
	if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) {
		return;
	}

	const target = event.target;
	if (target instanceof HTMLElement && (
		target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
	)) {
		return;
	}

	const buttonId = keyboardButtons[event.key.toLowerCase()];
	if (buttonId) {
		event.preventDefault();
		document.getElementById(buttonId).click();
		return;
	}

	const movement = movementKeys[event.key.toLowerCase()];
	if (!movement) {
		return;
	}

	event.preventDefault();
	const [axis, direction] = movement;
	movementAcceleration[axis] += direction * movementAccelerationValue;
	lastTimestamp = performance.now();
	scheduleAnimation();
});

function multiplyMatrices(left, right) {
	return left.map((row, rowIndex) => row.map((_, columnIndex) => (
		row.reduce((sum, __, index) => sum + left[rowIndex][index] * right[index][columnIndex], 0)
	)));
}

function rotateAroundScreenAxis(axis, angle) {
	const cosine = Math.cos(angle);
	const sine = Math.sin(angle);

	if (axis === "pitch") {
		return [
			[1, 0, 0],
			[0, cosine, -sine],
			[0, sine, cosine],
		];
	}

	if (axis === "yaw") {
		return [
			[cosine, 0, sine],
			[0, 1, 0],
			[-sine, 0, cosine],
		];
	}

	return [
		[cosine, -sine, 0],
		[sine, cosine, 0],
		[0, 0, 1],
	];
}

function applyRotation(axis, degrees) {
	const angle = degrees * Math.PI / 180;
	const screenRotation = rotateAroundScreenAxis(axis, angle);
	orientation = multiplyMatrices(screenRotation, orientation);
}

function getOrientationAngles() {
	const pitch = Math.atan2(orientation[2][1], orientation[2][2]);
	const yaw = Math.asin(Math.max(-1, Math.min(1, -orientation[2][0])));
	const roll = Math.atan2(orientation[1][0], orientation[0][0]);
	const degreesPerRadian = 180 / Math.PI;
	const pitchDegrees = (Math.round(pitch * degreesPerRadian * 100)/100).toFixed(2);

	return {
		roll: (Math.round(roll * degreesPerRadian * 100)/100),
		pitch: (Math.round(((pitchDegrees % 360) + 360) % 360 * 100)/100),
		yaw: (Math.round(yaw * degreesPerRadian * 100)/100),
	};
}

function formatAngle(value) {
	const sign = value < 0 ? "-" : "+";
	if (Math.abs(value) < 1) {
		return `${sign}${String(Math.abs(value).toFixed(4))}`;
	}
	return `${sign}${String(Math.abs(value).toFixed(2)).padStart(6, "0")}`;
}

function normalizeNumber(n) {
	if (n === 0) return { m: "0.00", e: 0 };
	const e = Math.floor(Math.log10(Math.abs(n)));
	const m = (n / Math.pow(10, e)).toFixed(2);
	return { m, e };
}


function formatValPower(value) {
	const sign = value < 0 ? "-" : "+";
	const absValue = Math.abs(value);
	const power = normalizeNumber(absValue);
	return `${sign}${String(power.m)}E${power.e}`;
}

function drawTriangleMarker(targetContext, tipX, tipY, baseLeftX, baseLeftY, baseRightX, baseRightY) {
	targetContext.beginPath();
	targetContext.moveTo(tipX, tipY);
	targetContext.lineTo(baseLeftX, baseLeftY);
	targetContext.lineTo(baseRightX, baseRightY);
	targetContext.closePath();
	targetContext.fillStyle = "#00ff66";
	targetContext.fill();
}

function drawVelocityTape(targetContext, centerX, centerY, value, label) {
	const tapeWidth = 28 * renderScale;
	const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
	const tapeHeight = 8 * 30 * devicePixelRatio;
	const maxTapeSpeed = 40;
	const pixelsPerUnit = 1.2 * renderScale;
	const left = centerX - tapeWidth / 2;
	const top = centerY - tapeHeight / 2;
	const centerLineY = centerY;

	targetContext.save();
	targetContext.beginPath();
	targetContext.rect(left, top, tapeWidth, tapeHeight);
	targetContext.clip();
	targetContext.fillStyle = "#777";
	targetContext.fillRect(left, top, tapeWidth, tapeHeight);
	targetContext.strokeStyle = "#eee";
	targetContext.fillStyle = "#d0d0d0";
	targetContext.lineWidth = 1.2 * renderScale;
	targetContext.font = `${7 * renderScale}px "Space Mono", monospace`;
	targetContext.textAlign = "right";
	targetContext.textBaseline = "middle";
	const visibleLimit = maxTapeSpeed + tapeHeight / (2 * pixelsPerUnit);
	const firstTick = Math.floor((value - visibleLimit) / 10) * 10;
	const lastTick = Math.ceil((value + visibleLimit) / 10) * 10;
	for (let tickValue = firstTick; tickValue <= lastTick; tickValue += 10) {
		const tickY = centerLineY + (value - tickValue) * pixelsPerUnit;
		const tickLength = tickValue % 20 === 0 ? 12 : 7;
		targetContext.beginPath();
		targetContext.moveTo(left + tapeWidth - tickLength, tickY);
		targetContext.lineTo(left + tapeWidth, tickY);
		targetContext.stroke();
		if (tickValue % 20 === 0) {
			targetContext.fillText(String(tickValue), left + tapeWidth - tickLength - 2 * renderScale, tickY);
		}
	}
	targetContext.restore();

	const markerTipX = left + tapeWidth - 2 * renderScale;
	const markerBaseX = left + tapeWidth + 9 * renderScale;
	targetContext.beginPath();
	targetContext.moveTo(left - 3 * renderScale, centerLineY);
	targetContext.lineTo(markerBaseX, centerLineY);
	targetContext.strokeStyle = "#ffe600";
	targetContext.lineWidth = 1 * renderScale;
	targetContext.stroke();
	targetContext.beginPath();
	targetContext.moveTo(markerTipX, centerLineY);
	targetContext.lineTo(markerBaseX, centerLineY - 6 * renderScale);
	targetContext.lineTo(markerBaseX, centerLineY + 6 * renderScale);
	targetContext.closePath();
	targetContext.fillStyle = "#ffe600";
	targetContext.fill();

	targetContext.fillStyle = "#fff";
	targetContext.font = `${9 * renderScale}px "Space Mono", monospace`;
	targetContext.textAlign = "center";
	targetContext.textBaseline = "middle";
	targetContext.fillText(
		formatAngle(value),
		centerX,
		top + tapeHeight + 12 * renderScale
	);
	targetContext.font = `${8 * renderScale}px "Space Mono", monospace`;
	targetContext.fillStyle = "#d0d0d0";
	targetContext.fillText(label, centerX, top - 7 * renderScale);

	const acceleration = movementAcceleration[label[0].toLowerCase()];
	if (acceleration !== 0) {
		const arrowX = left + 6 * renderScale;
		const direction = acceleration > 0 ? -1 : 1;
		const arrowLength = Math.min(
			tapeHeight / 2 - 6 * renderScale,
			Math.abs(acceleration) * 12 * renderScale
		);
		const arrowBaseY = centerLineY;
		const arrowTipY = arrowBaseY + direction * arrowLength;
		targetContext.beginPath();
		targetContext.moveTo(arrowX, arrowBaseY);
		targetContext.lineTo(arrowX, arrowTipY);
		targetContext.closePath();
		targetContext.fillStyle = "#ffe600";
		targetContext.strokeStyle = "#ffe600";
		targetContext.lineWidth = 1 * renderScale;
		targetContext.stroke();
		targetContext.beginPath();
		targetContext.moveTo(arrowX, arrowTipY);
		targetContext.lineTo(arrowX - 5 * renderScale, arrowTipY - direction * 7 * renderScale);
		targetContext.lineTo(arrowX + 5 * renderScale, arrowTipY - direction * 7 * renderScale);
		targetContext.closePath();
		targetContext.fillStyle = "#ffe600";
		targetContext.fill();
	}
}

function rotateSpherePoint(point) {
	return {
		x: orientation[0][0] * point.x + orientation[0][1] * point.y + orientation[0][2] * point.z,
		y: orientation[1][0] * point.x + orientation[1][1] * point.y + orientation[1][2] * point.z,
		z: orientation[2][0] * point.x + orientation[2][1] * point.y + orientation[2][2] * point.z,
	};
}

function resizeCanvas() {
	const bounds = canvas.getBoundingClientRect();
	const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
	const pixelRatio = devicePixelRatio;
	const width = Math.max(1, Math.round(bounds.width * pixelRatio));
	const height = Math.max(1, Math.round(bounds.height * pixelRatio));
	const rpyBounds = rpyCanvas.getBoundingClientRect();
	const rpyWidth = Math.max(1, Math.round(rpyBounds.width * pixelRatio));
	const rDotBounds = rDotCanvas.getBoundingClientRect();
	const rDotWidth = Math.max(1, Math.round(rDotBounds.width * pixelRatio));
	const rDotHeight = Math.max(1, Math.round(rDotBounds.height * pixelRatio));
	const pDotBounds = pDotCanvas.getBoundingClientRect();
	const pDotWidth = Math.max(1, Math.round(pDotBounds.width * pixelRatio));
	const pDotHeight = Math.max(1, Math.round(pDotBounds.height * pixelRatio));
	const yDotBounds = yDotCanvas.getBoundingClientRect();
	const yDotWidth = Math.max(1, Math.round(yDotBounds.width * pixelRatio));
	const yDotHeight = Math.max(1, Math.round(yDotBounds.height * pixelRatio));
	if (canvas.width === width && canvas.height === height
		&& backgroundCanvas.width === width && backgroundCanvas.height === height
		&& rpyCanvas.width === rpyWidth && rpyCanvas.height === height
		&& rDotCanvas.width === rDotWidth && rDotCanvas.height === rDotHeight
		&& pDotCanvas.width === pDotWidth && pDotCanvas.height === pDotHeight
		&& yDotCanvas.width === yDotWidth && yDotCanvas.height === yDotHeight) {
		renderScale = (width - 2 * canvasPadding * pixelRatio) / 300;
		return false;
	}

	canvas.width = width;
	canvas.height = height;
	backgroundCanvas.width = width;
	backgroundCanvas.height = height;
	rpyCanvas.width = rpyWidth;
	rpyCanvas.height = height;
	rDotCanvas.width = rDotWidth;
	rDotCanvas.height = rDotHeight;
	pDotCanvas.width = pDotWidth;
	pDotCanvas.height = pDotHeight;
	yDotCanvas.width = yDotWidth;
	yDotCanvas.height = yDotHeight;
	renderScale = (width - 2 * canvasPadding * pixelRatio) / 300;
	labelTextureRadius = 0;
	return true;
}

function drawHemisphereBackground(
	centerX,
	centerY,
	radius,
	image = context.createImageData(canvas.width, canvas.height),
	startY = 0,
	endY = image.height
) {
	const lightSide = [226, 226, 226];
	const darkSide = [30, 30, 30];
	const polarSide = [166, 0, 0];
	const tintColor = (base, tint) => base.map((channel, index) => (
		Math.round(channel * 0.8 + tint[index] * 255 * 0.2)
	));
	const pitch0NorthSide = tintColor(lightSide, [0.616, 0.396, 0.396]);
	const pitch0SouthSide = tintColor(lightSide, [0.266, 0.741, 0.827]);
	const pitch180NorthSide = tintColor(darkSide, [0.424, 0.173, 0.173]);
	const pitch180SouthSide = tintColor(darkSide, [0.024, 0.565, 0.663]);
	const polarBoundary = Math.sin(75 * Math.PI / 180);
	const equatorBoundary = Math.sin(2 * Math.PI / 180);

	for (let y = startY; y < endY; y += 1) {
		for (let x = 0; x < image.width; x += 1) {
			const screenX = (x - centerX) / radius;
			const screenY = (centerY - y) / radius;
			const depthSquared = 1 - screenX * screenX - screenY * screenY;
			if (depthSquared < 0) {
				continue;
			}

			const screenZ = Math.sqrt(depthSquared);
			const localX = orientation[0][0] * screenX
				+ orientation[1][0] * screenY
				+ orientation[2][0] * screenZ;
			const localY = orientation[0][1] * screenX
				+ orientation[1][1] * screenY
				+ orientation[2][1] * screenZ;
			const localZ = orientation[0][2] * screenX
				+ orientation[1][2] * screenY
				+ orientation[2][2] * screenZ;
			const absoluteLatitude = Math.abs(localX);
			const color = absoluteLatitude >= polarBoundary
				? polarSide
				: absoluteLatitude < equatorBoundary
					? localY >= 0 ? lightSide : darkSide
					: localY >= 0
						? localX >= 0 ? pitch0NorthSide : pitch0SouthSide
						: localX >= 0 ? pitch180NorthSide : pitch180SouthSide;
			const pixelIndex = (y * image.width + x) * 4;
			image.data[pixelIndex] = color[0];
			image.data[pixelIndex + 1] = color[1];
			image.data[pixelIndex + 2] = color[2];
			image.data[pixelIndex + 3] = 255;

			const labelLongitude = Math.atan2(localZ, localY);
			const textureX = ((labelLongitude / (2 * Math.PI) + 0.5) * labelTexture.width)
				% labelTexture.width;
			const textureY = Math.max(0, Math.min(
				labelTexture.height - 1,
				(0.5 - Math.asin(Math.max(-1, Math.min(1, localX))) / Math.PI) * labelTexture.height
			));
			const textureX0 = Math.floor(textureX);
			const textureY0 = Math.floor(textureY);
			const maskIndex = (textureY0 * labelGapTexture.width + textureX0) * 4;

			if (labelGapTexturePixels[maskIndex + 3] > 0) {
				const textureX1 = (textureX0 + 1) % labelTexture.width;
				const textureY1 = Math.min(labelTexture.height - 1, textureY0 + 1);
				const fractionX = textureX - textureX0;
				const fractionY = textureY - textureY0;
				let labelAlpha = 0;
				let labelRed = 0;
				let labelGreen = 0;
				let labelBlue = 0;

				for (let row = 0; row <= 1; row += 1) {
					for (let column = 0; column <= 1; column += 1) {
						const sampleX = column === 0 ? textureX0 : textureX1;
						const sampleY = row === 0 ? textureY0 : textureY1;
						const weightX = column === 0 ? 1 - fractionX : fractionX;
						const weightY = row === 0 ? 1 - fractionY : fractionY;
						const sampleIndex = (sampleY * labelTexture.width + sampleX) * 4;
						const alpha = labelTexturePixels[sampleIndex + 3] / 255 * weightX * weightY;
						labelAlpha += alpha;
						labelRed += labelTexturePixels[sampleIndex] * alpha;
						labelGreen += labelTexturePixels[sampleIndex + 1] * alpha;
						labelBlue += labelTexturePixels[sampleIndex + 2] * alpha;
					}
			}

			if (labelAlpha > 0) {
				image.data[pixelIndex] = Math.round(color[0] * (1 - labelAlpha) + labelRed);
				image.data[pixelIndex + 1] = Math.round(color[1] * (1 - labelAlpha) + labelGreen);
				image.data[pixelIndex + 2] = Math.round(color[2] * (1 - labelAlpha) + labelBlue);
			}
			}
		}
	}

	return image;
}

function drawGridLine(points, centerX, centerY, radius, fixedColor = null) {
	let drawingSegment = false;
	let segmentColor = null;
	let previousX = 0;
	let previousY = 0;

	for (const point of points) {
		const rotated = rotateSpherePoint(point);
		const visible = rotated.z >= -0.04;
		const x = centerX + rotated.x * radius;
		const y = centerY - rotated.y * radius;
		if (!visible || isPointInsideLabelGap(point)) {
			if (drawingSegment) {
				context.stroke();
				drawingSegment = false;
				segmentColor = null;
			}
			continue;
		}

		const color = fixedColor ?? (point.y >= 0 ? "#000000" : "#ffffff");
		if (!drawingSegment) {
			context.beginPath();
			context.strokeStyle = color;
			context.moveTo(x, y);
			drawingSegment = true;
			segmentColor = color;
		} else if (color !== segmentColor) {
			context.stroke();
			context.beginPath();
			context.strokeStyle = color;
			context.moveTo(previousX, previousY);
			context.lineTo(x, y);
			segmentColor = color;
		} else {
			context.lineTo(x, y);
		}
		previousX = x;
		previousY = y;
	}

	if (drawingSegment) {
		context.stroke();
	}
}

function drawCoordinateLabel(value, point, direction, radius, isBubble = false) {
	const latitude = Math.asin(Math.max(-1, Math.min(1, point.x)));
	const longitude = Math.atan2(point.z, point.y);
	const x = (longitude / (2 * Math.PI) + 0.5) * labelTexture.width;
	const y = (0.5 - latitude / Math.PI) * labelTexture.height;
	const fontSize = 13 * renderScale * labelTexture.width / (2 * Math.PI * radius);
	const padding = renderScale * labelTexture.width / (2 * Math.PI * radius);
	const bubblePadding = 4 * renderScale * labelTexture.width / (2 * Math.PI * radius);

	labelTextureContext.save();
	labelTextureContext.font = `400 ${fontSize}px "Space Mono", monospace`;
	labelTextureContext.textAlign = "center";
	labelTextureContext.textBaseline = "middle";
	const textWidth = labelTextureContext.measureText(value).width;
	const bubbleRadiusX = textWidth / 2 + bubblePadding;
	const bubbleRadiusY = fontSize * 0.35 + bubblePadding;
	const flipLongitudeLabel = direction === "longitude" && latitude < 0;
	for (const wrapOffset of [-labelTexture.width, 0, labelTexture.width]) {
		labelTextureContext.save();
		labelTextureContext.translate(x + wrapOffset, y);
		if (direction === "longitude") {
			labelTextureContext.rotate(-Math.PI / 2);
			if (flipLongitudeLabel) {
				labelTextureContext.rotate(Math.PI);
			}
		}
		if (isBubble) {
			labelTextureContext.beginPath();
			labelTextureContext.ellipse(
				0,
				0,
				bubbleRadiusX,
				bubbleRadiusY,
				0,
				0,
				Math.PI * 2
			);
			labelTextureContext.fillStyle = "#E2E2E2";
			labelTextureContext.fill();
		}
		labelTextureContext.fillStyle = isBubble
			? "#111111"
			: point.y >= 0 ? "#111111" : "#ffffff";
		labelTextureContext.scale(-1, 1);
		labelTextureContext.fillText(value, 0, 0);
		labelTextureContext.restore();

		labelGapTextureContext.save();
		labelGapTextureContext.translate(x + wrapOffset, y);
		if (direction === "longitude") {
			labelGapTextureContext.rotate(-Math.PI / 2);
			if (flipLongitudeLabel) {
				labelGapTextureContext.rotate(Math.PI);
			}
		}
		labelGapTextureContext.fillStyle = "#ffffff";
		if (isBubble) {
			labelGapTextureContext.beginPath();
			labelGapTextureContext.ellipse(
				0,
				0,
				bubbleRadiusX,
				bubbleRadiusY,
				0,
				0,
				Math.PI * 2
			);
			labelGapTextureContext.fill();
		} else {
			labelGapTextureContext.fillRect(
				-textWidth / 2 - padding,
				-fontSize / 2 - padding,
				textWidth + 2 * padding,
				fontSize + 2 * padding
			);
		}
		labelGapTextureContext.restore();
	}
	labelTextureContext.restore();
}

function drawTargetMarkerTexture(targetPosition, radius) {
	const targetDistance = Math.hypot(targetPosition.x, targetPosition.y, targetPosition.z);
	if (targetDistance === 0) {
		return;
	}

	const latitude = Math.asin(Math.max(-1, Math.min(1, -targetPosition.x / targetDistance)));
	const longitude = Math.atan2(targetPosition.z, targetPosition.y);
	const textureX = (longitude / (2 * Math.PI) + 0.5) * labelTexture.width;
	const textureY = (0.5 - latitude / Math.PI) * labelTexture.height;
	const textureRadius = 10 * renderScale * labelTexture.width / (2 * Math.PI * radius);
	const dotRadius = 4 * renderScale * labelTexture.width / (2 * Math.PI * radius);

	for (const wrapOffset of [-labelTexture.width, 0, labelTexture.width]) {
		labelTextureContext.save();
		labelTextureContext.translate(textureX + wrapOffset, textureY);
		labelTextureContext.beginPath();
		labelTextureContext.arc(0, 0, textureRadius, 0, Math.PI * 2);
		labelTextureContext.strokeStyle = "#ff4fa3";
		labelTextureContext.lineWidth = Math.max(2, textureRadius * 0.25);
		labelTextureContext.stroke();
		labelTextureContext.beginPath();
		labelTextureContext.arc(0, 0, dotRadius, 0, Math.PI * 2);
		labelTextureContext.fillStyle = "#ff4fa3";
		labelTextureContext.fill();
		labelTextureContext.restore();
	}
}

function drawProjectedTargetMarker(targetPosition, centerX, centerY, radius) {
	const targetDistance = Math.hypot(targetPosition.x, targetPosition.y, targetPosition.z);
	if (targetDistance === 0) {
		return;
	}

	const targetUnit = {
		x: targetPosition.x / targetDistance,
		y: targetPosition.y / targetDistance,
		z: targetPosition.z / targetDistance,
	};
	const reference = Math.abs(targetUnit.x) < 0.9
		? { x: 1, y: 0, z: 0 }
		: { x: 0, y: 1, z: 0 };
	const tangent = {
		x: targetUnit.y * reference.z - targetUnit.z * reference.y,
		y: targetUnit.z * reference.x - targetUnit.x * reference.z,
		z: targetUnit.x * reference.y - targetUnit.y * reference.x,
	};
	const tangentLength = Math.hypot(tangent.x, tangent.y, tangent.z);
	tangent.x /= tangentLength;
	tangent.y /= tangentLength;
	tangent.z /= tangentLength;
	const bitangent = {
		x: targetUnit.y * tangent.z - targetUnit.z * tangent.y,
		y: targetUnit.z * tangent.x - targetUnit.x * tangent.z,
		z: targetUnit.x * tangent.y - targetUnit.y * tangent.x,
	};
	const angularRadius = Math.min(0.18, 10 * renderScale / radius);
	const ringPoints = [];

	for (let step = 0; step <= 96; step += 1) {
		const angle = Math.PI * 2 * step / 96;
		const sine = Math.sin(angularRadius);
		const cosine = Math.cos(angularRadius);
		const spherePoint = {
			x: targetUnit.x * cosine + (tangent.x * Math.cos(angle) + bitangent.x * Math.sin(angle)) * sine,
			y: targetUnit.y * cosine + (tangent.y * Math.cos(angle) + bitangent.y * Math.sin(angle)) * sine,
			z: targetUnit.z * cosine + (tangent.z * Math.cos(angle) + bitangent.z * Math.sin(angle)) * sine,
		};
		ringPoints.push(rotateSpherePoint(spherePoint));
	}

	context.save();
	context.strokeStyle = "#ff4fa3";
	context.lineWidth = 2 * renderScale;
	context.shadowColor = "#000";
	context.shadowBlur = 3 * renderScale;
	let drawingSegment = false;
	for (const point of ringPoints) {
		if (point.z < -0.04) {
			if (drawingSegment) {
				context.stroke();
				drawingSegment = false;
			}
			continue;
		}
		const screenX = centerX + point.x * radius;
		const screenY = centerY - point.y * radius;
		if (!drawingSegment) {
			context.beginPath();
			context.moveTo(screenX, screenY);
			drawingSegment = true;
		} else {
			context.lineTo(screenX, screenY);
		}
	}
	if (drawingSegment) {
		context.stroke();
	}
	const dotAngularRadius = Math.min(0.1, 4 * renderScale / radius);
	const dotPoints = [];
	for (let step = 0; step <= 32; step += 1) {
		const angle = Math.PI * 2 * step / 32;
		const sine = Math.sin(dotAngularRadius);
		const cosine = Math.cos(dotAngularRadius);
		const spherePoint = {
			x: targetUnit.x * cosine + (tangent.x * Math.cos(angle) + bitangent.x * Math.sin(angle)) * sine,
			y: targetUnit.y * cosine + (tangent.y * Math.cos(angle) + bitangent.y * Math.sin(angle)) * sine,
			z: targetUnit.z * cosine + (tangent.z * Math.cos(angle) + bitangent.z * Math.sin(angle)) * sine,
		};
		dotPoints.push(rotateSpherePoint(spherePoint));
	}
	if (dotPoints.some((point) => point.z >= -0.04)) {
		context.beginPath();
		for (const [index, point] of dotPoints.entries()) {
			const screenX = centerX + point.x * radius;
			const screenY = centerY - point.y * radius;
			if (index === 0) {
				context.moveTo(screenX, screenY);
			} else {
				context.lineTo(screenX, screenY);
			}
		}
		context.closePath();
		context.fillStyle = "#ff4fa3";
		context.fill();
	}
	context.restore();
}

function drawGridPoint(angle, longitude) {
	return {
		x: Math.sin(angle),
		y: Math.cos(angle) * Math.cos(longitude),
		z: Math.cos(angle) * Math.sin(longitude),
	};
}

function formatCoordinate(angle) {
	let coordinate = 90 - Math.round(angle * 180 / Math.PI);
	coordinate = ((coordinate % 360) + 360) % 360;
	return String(coordinate).padStart(3, "0");
}

function formatLatitude(latitude) {
	return latitude; //hier
}

function buildCoordinateLabelTexture(radius, targetPosition) {
	if (labelTextureRadius === radius
		&& labelTextureTargetX === targetPosition.x
		&& labelTextureTargetY === targetPosition.y
		&& labelTextureTargetZ === targetPosition.z) {
		return;
	}

	labelTextureContext.clearRect(0, 0, labelTexture.width, labelTexture.height);
	labelGapTextureContext.clearRect(0, 0, labelGapTexture.width, labelGapTexture.height);
	for (let longitude = 0; longitude < 360; longitude += 30) {
		const longitudeRadians = longitude * Math.PI / 180;

		for (let latitude = -60; latitude <= 60; latitude += 30) {
			if (latitude !== 0) {
				const labelLongitude = longitudeRadians + 15 * Math.PI / 180;
				const point = drawGridPoint(latitude * Math.PI / 180, labelLongitude);
				drawCoordinateLabel(formatLatitude(latitude), point, "latitude", radius);
			}
		}

		const isGreenLongitude = longitude === 90 || longitude === 270;
		for (const latitude of [-45, -15, 15, 45]) {
			const point = drawGridPoint(latitude * Math.PI / 180, longitudeRadians);
			drawCoordinateLabel(
				formatCoordinate(longitudeRadians),
				point,
				"longitude",
				radius,
				isGreenLongitude
			);
		}
	}

	labelTexturePixels = labelTextureContext.getImageData(0, 0, labelTexture.width, labelTexture.height).data;
	labelGapTexturePixels = labelGapTextureContext.getImageData(0, 0, labelGapTexture.width, labelGapTexture.height).data;
	labelTextureRadius = radius;
	labelTextureTargetX = targetPosition.x;
	labelTextureTargetY = targetPosition.y;
	labelTextureTargetZ = targetPosition.z;
	labelTextureNeedsUpload = true;
}

function isPointInsideLabelGap(point) {
	const latitude = Math.asin(Math.max(-1, Math.min(1, point.x)));
	const longitude = Math.atan2(point.z, point.y);
	const textureX = (longitude / (2 * Math.PI) + 0.5) * labelGapTexture.width;
	const textureY = (0.5 - latitude / Math.PI) * labelGapTexture.height;
	const wrappedX = ((Math.floor(textureX) % labelGapTexture.width) + labelGapTexture.width)
		% labelGapTexture.width;
	const clampedY = Math.max(0, Math.min(labelGapTexture.height - 1, Math.floor(textureY)));
	const pixelIndex = (clampedY * labelGapTexture.width + wrappedX) * 4;
	return labelGapTexturePixels[pixelIndex + 3] > 0;
}

function drawNavball() {
	const width = canvas.width;
	const height = canvas.height;
	const centerX = width / 2;
	const centerY = height / 2;
	const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
	const radius = Math.min(width, height) / 2 - canvasPadding * devicePixelRatio - 4 * renderScale;
	const xDist = -targetRelativePosition.x;
	const yDist = -targetRelativePosition.y;
	const zDist = targetRelativePosition.z;
	buildCoordinateLabelTexture(radius, targetRelativePosition);
	const gpuRendered = drawWebGlBackground(radius);
	context.clearRect(0, 0, width, height);
	context.save();
	if (!gpuRendered) {
		drawHemisphereBackground(centerX, centerY, radius);
	}

	context.lineWidth = renderScale;

	for (let pitch = 0; pitch <= 90; pitch += 30) {
		const pitchRadians = pitch * Math.PI / 180;
		const points = [];

		for (let step = 0; step <= 72; step += 1) {
			const angle = Math.PI * 2 * step / 72;
			points.push(drawGridPoint(pitchRadians, angle));
		}

		drawGridLine(points, centerX, centerY, radius);
	}
	for (let pitch = -90; pitch <= 0; pitch += 30) {
		const pitchRadians = pitch * Math.PI / 180;
		const points = [];

		for (let step = 0; step <= 540; step += 1) {
			const angle = Math.PI * 2 * step / 540;
			points.push(drawGridPoint(pitchRadians, angle));
		}

		drawGridLine(points, centerX, centerY, radius);
	}

	for (const latitude of [-1, 1]) {
		const latitudeRadians = latitude * Math.PI / 180;
		const points = [];
		for (let step = 0; step <= 72; step += 1) {
			const longitude = Math.PI * 2 * step / 72;
			points.push(drawGridPoint(latitudeRadians, longitude));
		}

		drawGridLine(points, centerX, centerY, radius);
	}
	for (const latitude of [-75, 75]) {
		const latitudeRadians = latitude * Math.PI / 180;
		const points = [];

		for (let step = 0; step <= 72; step += 1) {
			const longitude = Math.PI * 2 * step / 72;
			points.push(drawGridPoint(latitudeRadians, longitude));
		}

		drawGridLine(points, centerX, centerY, radius);
	}
	for (const latitude of [-85, 85]) {
		const latitudeRadians = latitude * Math.PI / 180;
		const points = [];
		for (let step = 0; step <= 72; step += 1) {
			const longitude = Math.PI * 2 * step / 72;
			points.push(drawGridPoint(latitudeRadians, longitude));
		}

		drawGridLine(points, centerX, centerY, radius);
	}

	for (let longitude = 0; longitude < 360; longitude += 30) {
		const longitudeRadians = longitude * Math.PI / 180;
		const isGreenBoundary = longitude === 90 || longitude === 270;
		const reachesPoles = [0, 90, 180, 270].includes(longitude);
		const latitudeLimit = (reachesPoles ? 90 : 85) * Math.PI / 180;
		const stepCount = isGreenBoundary ? 720 : 72;
		const points = [];

		for (let step = 0; step <= stepCount; step += 1) {
			const latitude = -latitudeLimit + 2 * latitudeLimit * step / stepCount;
			points.push(drawGridPoint(latitude, longitudeRadians));
		}

		drawGridLine(points, centerX, centerY, radius, isGreenBoundary ? "#55d66f" : null);
	}

	// Hilfslinien 
	// 10er
	for (let latitude = -80; latitude <= 80; latitude += 10) {
		if (latitude % 30 === 0) {
			continue;
		}

		const latitudeRadians = latitude * Math.PI / 180;
		for (let longitudeStart = 10; longitudeStart < 360; longitudeStart += 30) {
			const points = [];
			const segmentStart = longitudeStart + border;
			const segmentEnd = longitudeStart + 10 - border;
			for (let step = 0; step <= 4; step += 1) {
				const longitude = (
					segmentStart + (segmentEnd - segmentStart) * step / 4
				) * Math.PI / 180;
				points.push(drawGridPoint(latitudeRadians, longitude));
			}

			drawGridLine(points, centerX, centerY, radius);
		}
	}
	for (let longitude = 10; longitude < 360; longitude += 10) {
		if (longitude % 30 === 0) {
			continue;
		}

		const longitudeRadians = longitude * Math.PI / 180;

		for (const direction of [-1, 1]) {
			for (let latitudeStart = 10; latitudeStart <= 50; latitudeStart += 30) {
				const points = [];
				const segmentStart = latitudeStart + border;
				const segmentEnd = latitudeStart + 10 - border;

				for (let step = 0; step <= 4; step += 1) {
					const latitude = direction * (
						segmentStart + (segmentEnd - segmentStart) * step / 4
					) * Math.PI / 180;
					points.push(drawGridPoint(latitude, longitudeRadians));
				}

				drawGridLine(points, centerX, centerY, radius);
			}
		}
	}
	//5er
	for (let latitude = -55; latitude <= 55; latitude += 10) {
		if (latitude % 10 === 0) {
			continue;
		}

		const latitudeRadians = latitude * Math.PI / 180;
		for (let longitudeStart = 15; longitudeStart < 360; longitudeStart += 15) {
			if (longitudeStart % 10 === 0) {
				continue;
			}

			const points = [];
			const segmentStart = longitudeStart - border;
			const segmentEnd = longitudeStart + border;
			for (let step = 0; step <= 4; step += 1) {
				const longitude = (
					segmentStart + (segmentEnd - segmentStart) * step / 4
				) * Math.PI / 180;
				points.push(drawGridPoint(latitudeRadians, longitude));
			}

			drawGridLine(points, centerX, centerY, radius);
		}
	}
	for (let longitude = 5; longitude < 360; longitude += 10) {
		if (longitude % 10 === 0) {
			continue;
		}

		const longitudeRadians = longitude * Math.PI / 180;

		for (const direction of [-1, 1]) {
			for (let latitudeStart = 15; latitudeStart <= 60; latitudeStart += 30) {
				if (latitudeStart % 10 === 0) {
					continue;
				}

				const points = [];
				const segmentStart = latitudeStart - border;
				const segmentEnd = latitudeStart + border;

				for (let step = 0; step <= 4; step += 1) {
					const latitude = direction * (
						segmentStart + (segmentEnd - segmentStart) * step / 4
					) * Math.PI / 180;
					points.push(drawGridPoint(latitude, longitudeRadians));
				}

				drawGridLine(points, centerX, centerY, radius);
			}
		}
	}
	// lon auf lat +-75
	for (let longitude = 5; longitude < 360; longitude += 5) {
		const isTenDegreeLine = longitude % 10 === 0;
		if (isTenDegreeLine && longitude % 30 === 0) {
			continue;
		}

		const longitudeRadians = longitude * Math.PI / 180;
		const segmentLength = isTenDegreeLine ? 3 : 2;

		for (const direction of [-1, 1]) {
			const points = [];
			for (let step = 0; step <= 4; step += 1) {
				const latitude = direction * (75 - segmentLength * step / 4) * Math.PI / 180;
				points.push(drawGridPoint(latitude, longitudeRadians));
			}

			drawGridLine(points, centerX, centerY, radius);
		}
	}
/*
	context.restore();
	context.beginPath();
	context.arc(centerX, centerY, radius, 0, Math.PI * 2);
	context.strokeStyle = "#f2f5f7";
	context.lineWidth = 3 * renderScale;
	context.stroke();
*/

	context.restore();
	drawProjectedTargetMarker(targetRelativePosition, centerX, centerY, radius);
	context.beginPath();
	context.strokeStyle = "#fff";
	context.arc(centerX, centerY, radius + 4 * renderScale, 0, Math.PI * 2);
	context.lineWidth = 2 * renderScale;
	context.stroke();

	context.beginPath();
	context.strokeStyle = "#fff";
	context.lineWidth = 2 * renderScale;

	for (let angle = 0; angle < 360; angle += 5) {
		const radians = angle * Math.PI / 180;
		const inner = radius + 1.4 * renderScale;
		const outer = inner + 10 + (angle % 10 === 0 ? 5 : 0) + (angle % 30 === 0 ? 5 : 0);

		context.moveTo(
			centerX + Math.sin(radians) * inner,
			centerY - Math.cos(radians) * inner
		);
		context.lineTo(
			centerX + Math.sin(radians) * outer,
			centerY - Math.cos(radians) * outer
		);
	}
	context.stroke();

	context.save();
	context.fillStyle = "#fff";
	context.font = `400 ${12 * renderScale}px "Space Mono", monospace`;
	context.textAlign = "center";
	context.textBaseline = "middle";
	const labelRadius = radius + 1.4 * renderScale + 40;
	for (let angle = 0; angle > -36; angle -= 3) {
		const radians = angle * Math.PI / 18;
		const x = centerX + Math.sin(radians) * labelRadius;
		const y = centerY - Math.cos(radians) * labelRadius;

		context.fillText(String(-angle).padStart(2, "0"), x, y);
	}
	context.restore();



	context.beginPath();
	context.moveTo(centerX - 40, centerY);
	context.lineTo(centerX -20, centerY);
	context.lineTo(centerX, centerY + 20);
	context.lineTo(centerX + 20, centerY);
	context.lineTo(centerX + 40, centerY);
	context.moveTo(centerX, centerY - 40);
	context.lineTo(centerX, centerY - 20);
	context.moveTo(centerX, centerY + 20);
	context.lineTo(centerX, centerY + 40);
	context.moveTo(centerX, centerY);
	context.arc(centerX, centerY, 1 * renderScale, 0, Math.PI * 2);
	context.strokeStyle = "#ffaa00";
	context.lineWidth = 2 * renderScale;
	context.stroke();

	rpyContext.clearRect(0, 0, rpyCanvas.width, rpyCanvas.height);
	rpyContext.save();
	rpyContext.fillStyle = "#fff";
	rpyContext.font = `400 ${12 * renderScale}px "Space Mono", monospace`;
	rpyContext.textAlign = "left";
	rpyContext.textBaseline = "middle";
	rpyContext.shadowColor = "#000";
	rpyContext.shadowBlur = 3 * renderScale;
	const rightReadoutOffset = centerX + labelRadius + 50 - canvas.width;
	const maxReadoutWidth = rpyContext.measureText("R:-180").width;
	const x = rpyCanvas.width - rightReadoutOffset - maxReadoutWidth;
	const y = centerY;
	const { roll: rollDeg, pitch: pitchDeg, yaw: yawDeg } = getOrientationAngles();
	rpyContext.fillText(`R:${formatAngle(rollDeg)}°`, x -28 * renderScale, y - 48 * renderScale);
	rpyContext.fillText(`P:${formatAngle(pitchDeg)}°`, x -28 * renderScale, y - 32 * renderScale);
	rpyContext.fillText(`Y:${formatAngle(yawDeg)}°`, x -28 * renderScale, y - 16 * renderScale);
	rpyContext.fillText(`X:${formatValPower(xDist)}m`, x -28 * renderScale, y + 16 * renderScale);
	rpyContext.fillText(`Y:${formatValPower(yDist)}m`, x -28 * renderScale, y + 32 * renderScale);
	rpyContext.fillText(`Z:${formatValPower(zDist)}m`, x -28 * renderScale, y + 48 * renderScale);
	rpyContext.fillText(`D:${formatValPower(Math.round(Math.sqrt(xDist*xDist + yDist*yDist + zDist*zDist)))}m`, x -28 * renderScale, y + 64 * renderScale);
	const tapeGap = 19 * renderScale;
	const tapeWidth = 28 * renderScale;
	const tapeY = y;
	drawVelocityTape(rpyContext, x - tapeWidth - tapeGap, tapeY, movementVelocity.x, "Xdot");
	drawVelocityTape(rpyContext, x - 2 * (tapeWidth + tapeGap), tapeY, movementVelocity.y, "Ydot");
	drawVelocityTape(rpyContext, x - 3 * (tapeWidth + tapeGap), tapeY, movementVelocity.z, "Zdot");
	rpyContext.restore();

	rDotContext.clearRect(0, 0, rDotCanvas.width, rDotCanvas.height);
	rDotContext.save();
	rDotContext.strokeStyle = "#fff";
	rDotContext.lineWidth = 1.5 * renderScale;
	rDotContext.shadowColor = "#000";
	rDotContext.shadowBlur = 3 * renderScale;
	const arcRadius = radius + 	12 * renderScale + 24 * devicePixelRatio;
	const rDotCenterY = centerY + 20 * devicePixelRatio;
	const arcStart = -130 * Math.PI / 180;
	const arcEnd = -50 * Math.PI / 180;
	rDotContext.beginPath();
	rDotContext.arc(centerX, rDotCenterY, arcRadius, arcStart, arcEnd);
	rDotContext.stroke();

	for (let angle = -40; angle <= 40; angle += 10) {
		const radians = (angle - 90) * Math.PI / 180;
		const innerRadius = arcRadius - renderScale;
		const tickLength = angle === 0 ? 10 : 7;
		const outerRadius = arcRadius + tickLength * renderScale;
		rDotContext.beginPath();
		rDotContext.moveTo(
			centerX + Math.cos(radians) * innerRadius,
			rDotCenterY + Math.sin(radians) * innerRadius
		);
		rDotContext.lineTo(
			centerX + Math.cos(radians) * outerRadius,
			rDotCenterY + Math.sin(radians) * outerRadius
		);
		rDotContext.stroke();
	}
	const rollRate = Math.max(-40, Math.min(40, rotationVelocity.roll));
	const rollAngle = (rollRate - 90) * Math.PI / 180;
	const markerTipRadius = arcRadius - 2 * renderScale;
	const markerBaseRadius = arcRadius + 8 * renderScale;
	const markerHalfAngle = 5 * renderScale / arcRadius;
	drawTriangleMarker(
		rDotContext,
		centerX + Math.cos(rollAngle) * markerTipRadius,
		rDotCenterY + Math.sin(rollAngle) * markerTipRadius,
		centerX + Math.cos(rollAngle - markerHalfAngle) * markerBaseRadius,
		rDotCenterY + Math.sin(rollAngle - markerHalfAngle) * markerBaseRadius,
		centerX + Math.cos(rollAngle + markerHalfAngle) * markerBaseRadius,
		rDotCenterY + Math.sin(rollAngle + markerHalfAngle) * markerBaseRadius
	);
	rDotContext.restore();

	pDotContext.clearRect(0, 0, pDotCanvas.width, pDotCanvas.height);
	pDotContext.save();
	pDotContext.strokeStyle = "#fff";
	pDotContext.lineWidth = 1.5 * renderScale;
	pDotContext.shadowColor = "#000";
	pDotContext.shadowBlur = 3 * renderScale;
	pDotContext.beginPath();
	const verticalLineX = centerX + arcRadius;
	const scaleSpacing = 30 * devicePixelRatio;
	const maxTickOffset = 4 * scaleSpacing;
	const tickLength = 6 * renderScale;
	pDotContext.moveTo(verticalLineX, centerY - maxTickOffset);
	pDotContext.lineTo(verticalLineX, centerY + maxTickOffset);
	pDotContext.stroke();
	pDotContext.beginPath();
	for (let offset = -maxTickOffset;
		offset <= maxTickOffset;
		offset += scaleSpacing) {
		const tickY = centerY + offset;
		pDotContext.moveTo(verticalLineX, tickY);
		pDotContext.lineTo(verticalLineX + tickLength, tickY);
	}
	pDotContext.stroke();
	const pitchRate = Math.max(-40, Math.min(40, rotationVelocity.pitch));
	const pitchMarkerY = centerY - pitchRate / 40 * maxTickOffset;
	drawTriangleMarker(
		pDotContext,
		verticalLineX - renderScale,
		pitchMarkerY,
		verticalLineX + 9 * renderScale,
		pitchMarkerY - 5 * renderScale,
		verticalLineX + 9 * renderScale,
		pitchMarkerY + 5 * renderScale
	);
	pDotContext.restore();

	yDotContext.clearRect(0, 0, yDotCanvas.width, yDotCanvas.height);
	yDotContext.save();
	yDotContext.strokeStyle = "#fff";
	yDotContext.lineWidth = 1.5 * renderScale;
	yDotContext.shadowColor = "#000";
	yDotContext.shadowBlur = 3 * renderScale;
	yDotContext.beginPath();
	const horizontalLineY = centerY + arcRadius;
	yDotContext.moveTo(centerX - maxTickOffset, horizontalLineY);
	yDotContext.lineTo(centerX + maxTickOffset, horizontalLineY);
	yDotContext.stroke();
	yDotContext.beginPath();
	for (let offset = -maxTickOffset;
		offset <= maxTickOffset;
		offset += scaleSpacing) {
		const tickX = centerX + offset;
		yDotContext.moveTo(tickX, horizontalLineY);
		yDotContext.lineTo(tickX, horizontalLineY + tickLength);
	}
	yDotContext.stroke();
	const yawRate = Math.max(-40, Math.min(40, rotationVelocity.yaw));
	const yawMarkerX = centerX - yawRate / 40 * maxTickOffset;
	drawTriangleMarker(
		yDotContext,
		yawMarkerX,
		horizontalLineY - renderScale,
		yawMarkerX - 5 * renderScale,
		horizontalLineY + 9 * renderScale,
		yawMarkerX + 5 * renderScale,
		horizontalLineY + 9 * renderScale
	);
	yDotContext.restore();

}

function animate(timestamp) {
	animationFrame = null;
	if (!isMoving()) {
		return;
	}

	const elapsedSeconds = (timestamp - lastTimestamp) / 1000;
	lastTimestamp = timestamp;

	for (const axis of ["x", "y", "z"]) {
		movementVelocity[axis] += movementAcceleration[axis] * elapsedSeconds;
		targetRelativePosition[axis] -= movementVelocity[axis] * elapsedSeconds;
	}

	for (const axis of ["pitch", "roll", "yaw"]) {
		rotationVelocity[axis] += rotationAcceleration[axis] * elapsedSeconds;
		applyRotation(axis, rotationVelocity[axis] * elapsedSeconds);
	}
	drawNavball();
	scheduleAnimation();
}

window.addEventListener("resize", () => {
	if (resizeCanvas()) {
		drawNavball();
	}
});

function random(min, max) {
  return Math.random() * (max - min) + min;
}

applyRotation("pitch", random(0, 360));
applyRotation("yaw", random(-90, 90));
applyRotation("roll", random(0, 360));


resizeCanvas();
drawNavball();
document.fonts.load('400 16px "Space Mono"').then(() => {
	labelTextureRadius = 0;
	drawNavball();
});
//https://wallpaperaccess.com/full/722554.jpg