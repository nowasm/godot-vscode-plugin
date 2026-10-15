extends Control

var reveal_initially_hidden = false
var initially_hidden: Label

func _ready():
	initially_hidden = Label.new()
	initially_hidden.name = "InitiallyHidden"
	initially_hidden.visible = false
	add_child(initially_hidden)
	var parent = Control.new()
	parent.name = "HiddenParent"
	parent.visible = false
	add_child(parent)
	var child = Label.new()
	child.name = "InheritedHidden"
	parent.add_child(child)
	var top_level = Label.new()
	top_level.name = "TopLevelVisible"
	top_level.set_as_toplevel(true)
	parent.add_child(top_level)
	var layer = CanvasLayer.new()
	layer.name = "HiddenLayer"
	layer.visible = false
	add_child(layer)
	var layer_child = Label.new()
	layer_child.name = "LayerChild"
	layer.add_child(layer_child)
	var visible_layer = CanvasLayer.new()
	visible_layer.name = "VisibleLayer"
	add_child(visible_layer)
	var spatial = Spatial.new()
	spatial.name = "HiddenSpatial"
	spatial.visible = false
	add_child(spatial)
	var spatial_child = Spatial.new()
	spatial_child.name = "SpatialChild"
	spatial.add_child(spatial_child)

func _process(_delta):
	initially_hidden.visible = reveal_initially_hidden
