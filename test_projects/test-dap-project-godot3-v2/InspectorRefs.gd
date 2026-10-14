extends Node

class Details extends Reference:
	var display_name = "Detailed Godot 3 object"
	var health = 42
	var owner

var object_refs = []
var object_dictionary = {}
var remove_child = false
var temporary: Label

func _ready():
	var details = Details.new()
	details.owner = self
	temporary = Label.new()
	temporary.name = "TemporaryLabel"
	temporary.text = "Expand me before removal"
	add_child(temporary)
	object_refs = [details, details, self, temporary]
	object_dictionary = {"details": details}

func _process(_delta):
	if remove_child and is_instance_valid(temporary):
		temporary.queue_free()
