/**
 * @author dmarcos / https://github.com/dmarcos
 *
 * It handles stereo rendering
 * If mozGetVRDevices API is not available it gracefuly falls back to a
 * regular renderer
 *
 * The HMD supported is the Oculus DK1 and The Web API doesn't currently allow
 * to query for the display resolution. The dimensions of the screen are temporarly
 * hardcoded (1280 x 800).
 *
 * For VR mode to work it has to be used with the Oculus enabled builds of Firefox:
 *
 * OSX: http://people.mozilla.com/~vladimir/vr/firefox-33.0a1.en-US.mac.dmg
 * WIN: http://people.mozilla.com/~vladimir/vr/firefox-33.0a1.en-US.win64-x86_64.zip
 *
 */
THREE.VREffect = function ( renderer, done ) {

	this._renderer = renderer;

	this._init = function() {
		var self = this;
		if ( !navigator.mozGetVRDevices ) {
			if ( done ) {
				done("Your browser is not VR Ready");
			}
			return;
		}
		navigator.mozGetVRDevices( gotVRDevices );
		function gotVRDevices( devices ) {
			var vrHMD;
			var error;
			for ( var i = 0; i < devices.length; ++i ) {
				if ( devices[i] instanceof HMDVRDevice ) {
					vrHMD = devices[i];
					self._vrHMD = vrHMD;
					self.leftEyeTranslation = vrHMD.getEyeTranslation( "left" );
					self.rightEyeTranslation = vrHMD.getEyeTranslation( "right" );
					self.leftEyeFOV = vrHMD.getRecommendedEyeFieldOfView( "left" );
					self.rightEyeFOV = vrHMD.getRecommendedEyeFieldOfView( "right" );
					break; // We keep the first we encounter
				}
			}
			if ( done ) {
				if ( !vrHMD ) {
				 error = 'HMD not available';
				}
				done( error );
			}
		}
	};

	this._init();

	this.render = function ( scene, camera ) {
		var renderer = this._renderer;
		var vrHMD = this._vrHMD;
		renderer.enableScissorTest( false );
		// VR render mode if HMD is available
		if ( vrHMD ) {
			this.renderStereo.apply( this, arguments );
			return;
		}
		// Regular render mode if not HMD
		renderer.render.apply( this._renderer , arguments );
	};

	this.renderStereo = function( scene, camera, renderTarget, forceClear ) {
		var cameraLeft;
		var cameraRight;
		var leftEyeTranslation = this.leftEyeTranslation;
		var rightEyeTranslation = this.rightEyeTranslation;
		var renderer = this._renderer;
		var rendererWidth = renderer.domElement.width / renderer.devicePixelRatio;
		var rendererHeight = renderer.domElement.height / renderer.devicePixelRatio;
		var eyeDivisionLine = rendererWidth / 2;
		renderer.enableScissorTest( true );
		renderer.clear();

		// Grab camera matrix from user.
		// This is interpreted as the head base.
		if ( camera.matrixAutoUpdate ) {
			camera.updateMatrix();
		}
		var eyeWorldMatrix = camera.matrixWorld.clone();

		cameraLeft = camera.clone();
		cameraRight = camera.clone();
		cameraLeft.projectionMatrix = this.FovToProjection( this.leftEyeFOV );
		cameraRight.projectionMatrix = this.FovToProjection( this.rightEyeFOV );
		cameraLeft.position.add(new THREE.Vector3(
			leftEyeTranslation.x, leftEyeTranslation.y, leftEyeTranslation.z) );
		cameraRight.position.add(new THREE.Vector3(
			rightEyeTranslation.x, rightEyeTranslation.y, rightEyeTranslation.z) );

		// render left eye
		renderer.setViewport( 0, 0, eyeDivisionLine, rendererHeight );
		renderer.setScissor( 0, 0, eyeDivisionLine, rendererHeight );
		renderer.render( scene, cameraLeft );

		// render right eye
		renderer.setViewport( eyeDivisionLine, 0, eyeDivisionLine, rendererHeight );
		renderer.setScissor( eyeDivisionLine, 0, eyeDivisionLine, rendererHeight );
		renderer.render( scene, cameraRight );

	};

	this.setFullScreen = function( enable ) {
		var renderer = this._renderer;
		var vrHMD = this._vrHMD;
		var canvasOriginalSize = this._canvasOriginalSize;
		if (!vrHMD) {
			return;
		}
		// If state doesn't change we do nothing
		if ( enable === this._fullScreen ) {
			return;
		}
		this._fullScreen = !!enable;

		// VR Mode disabled
		if ( !enable ) {
			// Restores canvas original size
			renderer.setSize( canvasOriginalSize.width, canvasOriginalSize.height );
			return;
		}
		// VR Mode enabled
		this._canvasOriginalSize = {
			width: renderer.domElement.width,
			height: renderer.domElement.height
		};
		fullScreen = true;
		// Hardcoded Rift display size
		renderer.setSize( 1280, 800 );
		vrHMD.xxxToggleElementVR( renderer.domElement );
		this.startFullscreen( vrHMD );
	};

	this.startFullscreen = function( vrHMD ) {
		var self = this;
		var renderer = this._renderer;
		document.addEventListener( "mozfullscreenchange", function() {
			if ( !document.mozFullScreenElement ) {
				self.setFullScreen( false );
			}
		},false );
		renderer.domElement.mozRequestFullScreen( { vrDisplay: vrHMD } );
	};

	this.FovToNDCScaleOffset = function( fov ) {
		var pxscale = 2.0 / (fov.leftTan + fov.rightTan);
		var pxoffset = (fov.leftTan - fov.rightTan) * pxscale * 0.5;
		var pyscale = 2.0 / (fov.upTan + fov.downTan);
		var pyoffset = (fov.upTan - fov.downTan) * pyscale * 0.5;
		return { scale: [pxscale, pyscale], offset: [pxoffset, pyoffset] };
	};

	this.FovPortToProjection = function( fov, rightHanded /* = true */, zNear /* = 0.01 */, zFar /* = 10000.0 */ )
	{
		rightHanded = rightHanded === undefined ? true : rightHanded;
		zNear = zNear === undefined ? 0.01 : zNear;
		zFar = zFar === undefined ? 10000.0 : zFar;

		var handednessScale = rightHanded ? -1.0 : 1.0;

		// start with an identity matrix
		var mobj = new THREE.Matrix4();
		var m = mobj.elements;

		// and with scale/offset info for normalized device coords
		var scaleAndOffset = this.FovToNDCScaleOffset(fov);

		// X result, map clip edges to [-w,+w]
		m[0*4+0] = scaleAndOffset.scale[0];
		m[0*4+1] = 0.0;
		m[0*4+2] = scaleAndOffset.offset[0] * handednessScale;
		m[0*4+3] = 0.0;

		// Y result, map clip edges to [-w,+w]
		// Y offset is negated because this proj matrix transforms from world coords with Y=up,
		// but the NDC scaling has Y=down (thanks D3D?)
		m[1*4+0] = 0.0;
		m[1*4+1] = scaleAndOffset.scale[1];
		m[1*4+2] = -scaleAndOffset.offset[1] * handednessScale;
		m[1*4+3] = 0.0;

		// Z result (up to the app)
		m[2*4+0] = 0.0;
		m[2*4+1] = 0.0;
		m[2*4+2] = zFar / (zNear - zFar) * -handednessScale;
		m[2*4+3] = (zFar * zNear) / (zNear - zFar);

		// W result (= Z in)
		m[3*4+0] = 0.0;
		m[3*4+1] = 0.0;
		m[3*4+2] = handednessScale;
		m[3*4+3] = 0.0;

		mobj.transpose();

		return mobj;
	};

	this.FovToProjection = function( fov, rightHanded /* = true */, zNear /* = 0.01 */, zFar /* = 10000.0 */ )
	{
		var fovPort = {
			upTan: Math.tan(fov.upDegrees * Math.PI / 180.0),
			downTan: Math.tan(fov.downDegrees * Math.PI / 180.0),
			leftTan: Math.tan(fov.leftDegrees * Math.PI / 180.0),
			rightTan: Math.tan(fov.rightDegrees * Math.PI / 180.0)
		};
		return this.FovPortToProjection(fovPort, rightHanded, zNear, zFar);
	};

};