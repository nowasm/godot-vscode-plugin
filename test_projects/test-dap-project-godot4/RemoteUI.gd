extends Control

@export var show_dynamic_child := false
var dynamic_child: Label

func _process(_delta: float) -> void:
	if show_dynamic_child and not is_instance_valid(dynamic_child):
		dynamic_child = Label.new()
		dynamic_child.name = "RuntimeLabel"
		dynamic_child.text = "Created while the game is running"
		$Panel/VBox.add_child(dynamic_child)
	elif not show_dynamic_child and is_instance_valid(dynamic_child):
		dynamic_child.queue_free()
