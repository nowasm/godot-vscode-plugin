extends Control

@export var show_dynamic_child := false
var dynamic_child: Label
var object_refs: Array
var object_dictionary: Dictionary

func _ready() -> void:
	var resource := Resource.new()
	resource.resource_name = "Inspectable resource"
	object_refs = [$Panel/VBox/PlayButton, self, resource]
	object_dictionary = {"button": $Panel/VBox/PlayButton}

func _process(_delta: float) -> void:
	if show_dynamic_child and not is_instance_valid(dynamic_child):
		dynamic_child = Label.new()
		dynamic_child.name = "RuntimeLabel"
		dynamic_child.text = "Created while the game is running"
		$Panel/VBox.add_child(dynamic_child)
	elif not show_dynamic_child and is_instance_valid(dynamic_child):
		dynamic_child.queue_free()
